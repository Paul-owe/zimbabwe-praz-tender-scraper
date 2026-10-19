import { setTimeout as delay } from 'node:timers/promises';

import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

import log from '@apify/log';

import { parseInput } from './config/input.js';
import { buildListTenderFromCells, extractTenderRowsFromPage, goToNextResultsPage } from './crawlers/listing.js';
import { parseDetailTender } from './crawlers/tender-details.js';
import { analyzePublicDocuments, cleanDocumentLinks } from './services/document-analyzer.js';
import { applyMonitoringFields, openPersistentState, shouldEmitTender } from './services/persistent-state.js';
import {
    buildKeyRequirementsSummary,
    detectSiteVisit,
    extractBidSecurity,
    extractRequirementSignals,
} from './services/requirements-extractor.js';
import { calculateOpportunity, calculateRisk } from './services/scoring.js';
import { calculateDaysRemaining, deadlineWarning, toIsoDate } from './utils/dates.js';
import { classifyBusinessCategory, matchesListFilters, matchesTenderFilters } from './utils/filters.js';
import { cleanText } from './utils/text.js';

await Actor.init();

const runStartedAt = new Date().toISOString();
const input = await Actor.getInput();
const config = parseInput(input || {});
const state = await openPersistentState(config.stateStoreId);

if (config.resetSeenTenders) {
    await state.reset();
    log.info(`Reset isolated tender monitoring state: ${config.stateStoreId}`);
}
if (!state.enabled && config.detectChanges) {
    log.warning('Cross-run change detection is disabled because no explicit stateStoreId was provided.');
    config.detectChanges = false;
}

let savedCount = 0;
let pendingWrites = 0;
let queuedCount = 0;
let processedCount = 0;
let discoveredCount = 0;
let newTendersFound = 0;
let updatedTendersFound = 0;
let unchangedTenders = 0;
let pagesVisited = 0;
let documentsAnalyzed = 0;
let failedDocuments = 0;
let skippedExistingCount = 0;
let skippedByFilterCount = 0;
const errors = [];
const seenTenderIdsThisRun = new Set();
const queuedDetailUrls = new Set();

function emptyRequirements() {
    return {
        mandatoryRequirements: [],
        eligibilityRequirements: [],
        submissionRequirements: [],
        financialRequirements: [],
        technicalRequirements: [],
        mandatoryRequirementEvidence: [],
        eligibilityRequirementEvidence: [],
        submissionRequirementEvidence: [],
        financialRequirementEvidence: [],
        technicalRequirementEvidence: [],
        siteVisitRequired: null,
        siteVisitDate: null,
        siteVisitLocation: null,
        preBidMeetingRequired: null,
        preBidMeetingDate: null,
        requirementCount: 0,
    };
}

function buildReadinessChecklist(tender) {
    const requirements = [
        ...tender.mandatoryRequirements.map((item) => ({ item, category: 'Mandatory' })),
        ...tender.eligibilityRequirements.map((item) => ({ item, category: 'Eligibility' })),
        ...tender.submissionRequirements.map((item) => ({ item, category: 'Submission' })),
        ...tender.financialRequirements.map((item) => ({ item, category: 'Financial' })),
        ...tender.technicalRequirements.map((item) => ({ item, category: 'Technical' })),
    ];
    const checklist = requirements.map(({ item, category }) => ({
        item: typeof item === 'string' ? item : item.requirement,
        category,
        required: true,
        verifiedFromSource: true,
        completed: false,
    }));

    if (tender.bidSecurityRequired === true) {
        checklist.push({
            item: 'Prepare the stated bid security',
            category: 'Financial',
            required: true,
            verifiedFromSource: true,
            completed: false,
        });
    }
    if (tender.siteVisitRequired === true) {
        checklist.push({
            item: 'Attend or confirm the mandatory site visit',
            category: 'Mandatory',
            required: true,
            verifiedFromSource: true,
            completed: false,
        });
    }
    return checklist.filter((item, index, all) => all.findIndex((candidate) => candidate.item === item.item) === index);
}

function buildAlertFields(tender) {
    let titlePrefix = 'Updated';
    if (tender.isNew) titlePrefix = 'New';
    else if (tender.alertReason === 'NONE') titlePrefix = 'Tender';
    const category =
        tender.businessCategory && tender.businessCategory !== 'Other' ? ` ${tender.businessCategory}` : '';
    const buyer = tender.buyer || 'PRAZ eGP';
    const title = tender.title || tender.tenderReferenceNumber || 'public procurement opportunity';
    let alertPriority = 'MEDIUM';
    if (tender.riskLevel === 'HIGH' || (tender.isNew && tender.daysRemaining !== null && tender.daysRemaining <= 5))
        alertPriority = 'HIGH';
    else if (tender.alertReason === 'NONE') alertPriority = 'LOW';
    return {
        alertType: tender.alertReason,
        alertTitle: `${titlePrefix}${category} Tender Available`,
        alertMessage: `${buyer}: ${title}${tender.closingDate ? `; closing ${tender.closingDate}` : ''}.`,
        alertPriority,
        detectedAt: tender.lastSeenAt,
    };
}

function buildSummary(tender) {
    const buyer = tender.buyer || 'The procuring entity';
    const title = tender.title || 'public tender';
    const closing = tender.closingDate || 'an unspecified closing date';
    const requirements = tender.requirementCount
        ? ` ${tender.requirementCount} verified requirement signal(s) were detected.`
        : '';
    return `${buyer} published ${title}. Closing date: ${closing}.${requirements}`;
}

function buildTenderDocumentSummary(tender) {
    if (!tender.hasPublicDocuments) return null;
    const status =
        tender.documentAnalysisStatus === 'COMPLETED' || tender.documentAnalysisStatus === 'PARTIAL'
            ? ` ${tender.documentsAnalyzed} public PDF document(s) were analyzed.`
            : ' Document text analysis was not completed.';
    return `Detected ${tender.documentCount} tender-specific public document link(s).${status}`;
}

function enrichTender(
    base,
    {
        detailText = '',
        documentLinks = [],
        documentAnalysis = {},
        extractRequirements = true,
        now = new Date().toISOString(),
    } = {},
) {
    const tender = {
        ...base,
        categoryCode: base.categoryCode || null,
        documentLinks,
        ...documentAnalysis,
        daysRemaining: calculateDaysRemaining(base.closingDate, new Date(now)),
        closingDateIso: toIsoDate(base.closingDate),
        publishDateIso: toIsoDate(base.publishDate),
        businessCategory: classifyBusinessCategory(base),
    };

    tender.documentCount = documentLinks.length;
    tender.hasPublicDocuments = documentLinks.length > 0;
    tender.documentUrls = documentLinks.map((document) => document.href).join(' | ');
    tender.documentTitles = documentLinks.map((document) => document.text).join(' | ');
    tender.documentAnalysisStatus ||= 'DISABLED';
    tender.documentsAnalyzed ||= 0;
    tender.documentAnalysisErrors ||= [];
    tender.documentTextExtracted ||= false;
    tender.tenderDocumentSummary = buildTenderDocumentSummary(tender);

    const requirements =
        extractRequirements && (detailText || tender.documentText)
            ? extractRequirementSignals({
                  detailText,
                  documents: documentAnalysis.documents,
                  sourceUrl: base.sourceUrl,
              })
            : emptyRequirements();
    Object.assign(tender, requirements);
    if (tender.siteVisitRequired === undefined) Object.assign(tender, detectSiteVisit(detailText, base.sourceUrl));
    Object.assign(tender, extractBidSecurity(tender, [detailText, tender.documentText].filter(Boolean).join('\n')));
    tender.keyRequirementsSummary = buildKeyRequirementsSummary(tender);
    tender.readinessChecklist = buildReadinessChecklist(tender);

    Object.assign(tender, calculateRisk(tender));
    Object.assign(tender, calculateOpportunity(tender));
    tender.deadlineWarning = deadlineWarning(tender.daysRemaining);
    tender.summary = buildSummary(tender);
    return tender;
}

function addMonitoringAndAlertFields(tender) {
    Object.assign(tender, applyMonitoringFields(tender, state, new Date().toISOString()));
    Object.assign(tender, buildAlertFields(tender));
    return tender;
}

async function saveTender(tender) {
    if (savedCount + pendingWrites >= config.maxItems) return false;
    pendingWrites += 1;
    try {
        await Actor.pushData(tender);
        savedCount += 1;
        state.record(tender);
        return true;
    } finally {
        pendingWrites -= 1;
    }
}

async function processTender(tender) {
    processedCount += 1;
    addMonitoringAndAlertFields(tender);
    if (tender.isNew === true) newTendersFound += 1;
    else if (tender.hasChanges) updatedTendersFound += 1;
    else if (tender.isNew === false) unchangedTenders += 1;

    if (!matchesTenderFilters(tender, config.filters)) {
        skippedByFilterCount += 1;
        return;
    }
    if (!shouldEmitTender(tender, config)) {
        skippedExistingCount += 1;
        return;
    }
    if (!(await saveTender(tender))) return;
    log.info(`Saved tender ${savedCount}/${config.maxItems}: ${tender.tenderId || tender.title}`);
}

function listFiltersForQueue() {
    if (!config.includeDetails) return config.filters;
    return {
        ...config.filters,
        keyword: config.extractRequirements ? '' : config.filters.keyword,
        procurementMethodKeyword: '',
        classOfProcurementKeyword: '',
        businessCategory: '',
    };
}

const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: config.maxItems + config.maxPages + 50,
    requestHandlerTimeoutSecs: config.analyzeDocuments ? 180 : 120,
    maxConcurrency: config.analyzeDocuments ? 2 : 4,
    launchContext: { launchOptions: { headless: true } },
    preNavigationHooks: [
        async ({ page }, gotoOptions) => {
            // Crawlee expects these navigation settings to be assigned to the hook options.
            // eslint-disable-next-line no-param-reassign
            gotoOptions.waitUntil = 'networkidle';
            // eslint-disable-next-line no-param-reassign
            gotoOptions.timeout = 60_000;
            await page.setExtraHTTPHeaders({
                'User-Agent': 'PRAZ-Tender-Scraper/0.4',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            });
        },
    ],
    async requestHandler({ page, request, enqueueLinks }) {
        const label = request.userData.label || 'LIST';
        log.info(`Processing ${label}: ${request.url}`);
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1500);

        if (label === 'DETAIL') {
            const bodyText = await page
                .locator('body')
                .innerText()
                .catch(() => '');
            const lines = bodyText.split(/\r?\n/).map(cleanText).filter(Boolean);
            const rawLinks = await page.$$eval('a', (anchors) =>
                anchors.map((anchor) => ({ text: anchor.innerText, href: anchor.href })),
            );
            const documentLinks = cleanDocumentLinks(rawLinks);
            const documentAnalysis = await analyzePublicDocuments(documentLinks, {
                analyzeDocuments: config.analyzeDocuments,
                maxDocumentsPerTender: config.maxDocumentsPerTender,
                maxDocumentSizeMB: config.maxDocumentSizeMB,
                documentTextMaxChars: config.documentTextMaxChars,
            });
            documentsAnalyzed += documentAnalysis.documentsAnalyzed || 0;
            failedDocuments += documentAnalysis.documentAnalysisErrors?.length || 0;
            const base = parseDetailTender({
                lines,
                listData: request.userData.listData || {},
                sourceUrl: request.url,
            });
            const tender = enrichTender(base, {
                detailText: config.extractRequirements ? bodyText : '',
                documentLinks,
                documentAnalysis,
                extractRequirements: config.extractRequirements,
            });
            await processTender(tender);
            return;
        }

        for (let currentPage = 1; currentPage <= config.maxPages; currentPage += 1) {
            if (savedCount + pendingWrites >= config.maxItems) break;
            pagesVisited += 1;
            const rows = await extractTenderRowsFromPage(page);
            discoveredCount += rows.length;
            log.info(`Page ${currentPage}: found ${rows.length} tender rows.`);

            for (const row of rows) {
                if (savedCount + pendingWrites >= config.maxItems) break;
                const listTender = buildListTenderFromCells(row.cells, row.href);
                if (!listTender.tenderId || seenTenderIdsThisRun.has(listTender.tenderId)) continue;
                seenTenderIdsThisRun.add(listTender.tenderId);
                if (!matchesListFilters(listTender, listFiltersForQueue())) {
                    skippedByFilterCount += 1;
                    continue;
                }
                if (!config.includeDetails) {
                    await processTender(enrichTender(listTender));
                    continue;
                }
                const detailUrl = row.href || listTender.sourceUrl;
                if (queuedDetailUrls.has(detailUrl)) continue;
                queuedDetailUrls.add(detailUrl);
                await enqueueLinks({ urls: [detailUrl], label: 'DETAIL', userData: { listData: listTender } });
                queuedCount += 1;
            }
            if (currentPage >= config.maxPages || savedCount + pendingWrites >= config.maxItems) break;
            if (!(await goToNextResultsPage(page))) break;
        }
    },
    failedRequestHandler({ request, error }) {
        const message = `${request.url}: ${error?.message || 'request failed'}`;
        errors.push(message);
        log.error(message);
    },
});

Actor.on('aborting', async () => {
    await state.flush().catch(() => {});
    await delay(1000);
    await Actor.exit();
});

try {
    await crawler.run([{ url: config.startUrl, userData: { label: 'LIST' } }]);
} catch (error) {
    errors.push(error?.message || String(error));
    log.exception(error, 'Crawler run failed');
} finally {
    try {
        await state.flush();
    } catch (error) {
        errors.push(`State persistence failed: ${error?.message || error}`);
        log.exception(error, 'Failed to persist tender monitoring state');
    }
    const finishedAt = new Date().toISOString();
    await Actor.setValue('OUTPUT', {
        version: '0.4.0',
        runStatus: errors.length ? 'PARTIAL' : 'COMPLETED',
        totalPagesVisited: pagesVisited,
        totalTendersDiscovered: discoveredCount,
        totalTendersProcessed: processedCount,
        totalTendersSaved: savedCount,
        newTendersFound,
        updatedTendersFound,
        unchangedTenders,
        documentsAnalyzed,
        failedDocuments,
        errors,
        startedAt: runStartedAt,
        finishedAt,
        stateStoreConfigured: state.enabled,
        stateStoreId: state.storeId,
        maxItems: config.maxItems,
        maxPages: config.maxPages,
        includeDetails: config.includeDetails,
        newOnly: config.newOnly,
        detectChanges: config.detectChanges,
        includeStatusChanges: config.includeStatusChanges,
        analyzeDocuments: config.analyzeDocuments,
        extractRequirements: config.extractRequirements,
        skippedExistingCount,
        skippedByFilterCount,
        totalQueued: queuedCount,
        filters: config.filters,
    });
}

await Actor.exit();
