import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

await Actor.init();

const input = await Actor.getInput();

const runStartedAt = new Date().toISOString();

const startUrl = input?.startUrl || 'https://egp.praz.org.zw/Indexes/index';

const maxItems = toPositiveInteger(input?.maxItems, 50, 1, 1000);
const maxPages = toPositiveInteger(input?.maxPages, 1, 1, 100);

const keyword = cleanText(input?.keyword).toLowerCase();
const buyerKeyword = cleanText(input?.buyerKeyword).toLowerCase();
const categoryKeyword = cleanText(input?.categoryKeyword).toLowerCase();
const statusKeyword = cleanText(input?.statusKeyword).toLowerCase();
const procurementMethodKeyword = cleanText(input?.procurementMethodKeyword).toLowerCase();
const classOfProcurementKeyword = cleanText(input?.classOfProcurementKeyword).toLowerCase();
const businessCategoryFilter = cleanText(input?.businessCategory).toLowerCase();

const minimumDaysRemaining = toPositiveInteger(input?.minimumDaysRemaining, 0, 0, 10000);
const maximumDaysRemaining = toPositiveInteger(input?.maximumDaysRemaining, 0, 0, 10000);

const onlyOpen = input?.onlyOpen ?? false;
const includeDetails = input?.includeDetails ?? true;

// Version 0.3
const newOnly = input?.newOnly ?? false;
const resetSeenTenders = input?.resetSeenTenders ?? false;
const memoryStoreName = cleanText(input?.memoryStoreName) || 'praz-tender-memory';

// Version 0.4
const extractRequirements = input?.extractRequirements ?? true;
const analyzeDocuments = input?.analyzeDocuments ?? false;
const maxDocumentsPerTender = toPositiveInteger(input?.maxDocumentsPerTender, 2, 0, 10);
const maxPdfBytes = toPositiveInteger(input?.maxPdfBytes, 2_000_000, 100_000, 15_000_000);
const documentTextMaxChars = toPositiveInteger(input?.documentTextMaxChars, 12_000, 1000, 100_000);

let savedCount = 0;
let queuedCount = 0;
let skippedExistingCount = 0;
let skippedByFilterCount = 0;
let documentAnalysisSuccessCount = 0;
let documentAnalysisFailedCount = 0;

const queuedDetailUrls = new Set();
const seenTenderIdsThisRun = new Set();

const memoryStore = await Actor.openKeyValueStore(memoryStoreName);
let tenderMemory = {};

if (resetSeenTenders) {
    await memoryStore.setValue('SEEN_TENDERS', {});
    log.info(`Reset tender memory in key-value store: ${memoryStoreName}`);
} else {
    tenderMemory = (await memoryStore.getValue('SEEN_TENDERS')) || {};
}

function cleanText(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function toPositiveInteger(value, defaultValue, min, max) {
    const number = Number(value);

    if (!Number.isFinite(number)) return defaultValue;

    return Math.max(min, Math.min(max, Math.floor(number)));
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePrazDate(value) {
    const text = cleanText(value);
    if (!text) return null;

    const months = {
        jan: 0,
        feb: 1,
        mar: 2,
        apr: 3,
        may: 4,
        jun: 5,
        jul: 6,
        aug: 7,
        sep: 8,
        oct: 9,
        nov: 10,
        dec: 11,
    };

    const match = text.match(
        /^(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/i,
    );

    if (match) {
        const [, dd, mmm, yyyy, hh, min, ampm] = match;
        const month = months[mmm.toLowerCase()];

        if (month === undefined) return null;

        let hour = Number(hh);

        if (ampm?.toUpperCase() === 'PM' && hour < 12) hour += 12;
        if (ampm?.toUpperCase() === 'AM' && hour === 12) hour = 0;

        return new Date(Number(yyyy), month, Number(dd), hour, Number(min));
    }

    const fallback = Date.parse(text);
    return Number.isNaN(fallback) ? null : new Date(fallback);
}

function calculateDaysRemaining(dateText) {
    const date = parsePrazDate(dateText);
    if (!date) return null;

    const now = new Date();
    const diffMs = date.getTime() - now.getTime();

    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function toIsoDate(dateText) {
    const date = parsePrazDate(dateText);
    return date ? date.toISOString() : null;
}

function normalizeEmptyValue(value, label = '') {
    const cleaned = cleanText(value);
    const labelLower = cleanText(label).toLowerCase();
    const cleanedLower = cleaned.toLowerCase();

    if (!cleaned) return null;
    if (cleaned === '-') return null;
    if (cleanedLower === labelLower) return null;
    if (cleanedLower === `${labelLower}:`) return null;
    if (cleanedLower.endsWith(':') && cleanedLower.includes(labelLower)) return null;

    return cleaned;
}

function isOpenOrActive(status) {
    const normalized = cleanText(status).toLowerCase();

    return ['open', 'published', 'active'].includes(normalized);
}

function includesKeyword(value, query) {
    if (!query) return true;

    return cleanText(value).toLowerCase().includes(query);
}

function combinedTenderText(tender) {
    return [
        tender.tenderId,
        tender.tenderReferenceNumber,
        tender.title,
        tender.categoryCode,
        tender.category,
        tender.buyer,
        tender.status,
        tender.procurementMethod,
        tender.classOfProcurement,
        tender.deliveryLocation,
        tender.businessCategory,
        tender.mandatoryRequirements?.join(' '),
        tender.eligibilityRequirements?.join(' '),
    ]
        .join(' ')
        .toLowerCase();
}

function shouldKeepTender(tender) {
    const text = combinedTenderText(tender);

    if (keyword && !text.includes(keyword)) return false;
    if (buyerKeyword && !includesKeyword(tender.buyer, buyerKeyword)) return false;

    if (
        categoryKeyword &&
        !includesKeyword(`${tender.categoryCode || ''} ${tender.category || ''}`, categoryKeyword)
    ) {
        return false;
    }

    if (statusKeyword && !includesKeyword(tender.status, statusKeyword)) return false;

    if (
        procurementMethodKeyword &&
        !includesKeyword(tender.procurementMethod, procurementMethodKeyword)
    ) {
        return false;
    }

    if (
        classOfProcurementKeyword &&
        !includesKeyword(tender.classOfProcurement, classOfProcurementKeyword)
    ) {
        return false;
    }

    if (
        businessCategoryFilter &&
        !includesKeyword(tender.businessCategory, businessCategoryFilter)
    ) {
        return false;
    }

    if (onlyOpen && !isOpenOrActive(tender.status)) return false;

    if (minimumDaysRemaining > 0) {
        if (tender.daysRemaining === null || tender.daysRemaining < minimumDaysRemaining) {
            return false;
        }
    }

    if (maximumDaysRemaining > 0) {
        if (tender.daysRemaining === null || tender.daysRemaining > maximumDaysRemaining) {
            return false;
        }
    }

    return true;
}

function shouldQueueListTender(listData) {
    if (onlyOpen && !isOpenOrActive(listData.status)) return false;

    if (buyerKeyword && !includesKeyword(listData.buyer, buyerKeyword)) return false;

    if (
        categoryKeyword &&
        !includesKeyword(`${listData.categoryCode || ''} ${listData.category || ''}`, categoryKeyword)
    ) {
        return false;
    }

    if (statusKeyword && !includesKeyword(listData.status, statusKeyword)) return false;

    const daysRemaining = calculateDaysRemaining(listData.closingDate);

    if (minimumDaysRemaining > 0) {
        if (daysRemaining === null || daysRemaining < minimumDaysRemaining) return false;
    }

    if (maximumDaysRemaining > 0) {
        if (daysRemaining === null || daysRemaining > maximumDaysRemaining) return false;
    }

    if (keyword) {
        const listText = [
            listData.tenderId,
            listData.tenderReferenceNumber,
            listData.title,
            listData.categoryCode,
            listData.category,
            listData.buyer,
            listData.status,
        ]
            .join(' ')
            .toLowerCase();

        if (!listText.includes(keyword)) return false;
    }

    return true;
}

function buildSummary(tender) {
    const buyer = tender.buyer || 'A procuring entity';
    const title = tender.title || 'a procurement opportunity';
    const closingDate = tender.closingDate || 'not provided';
    const category = tender.businessCategory || tender.category || 'General';

    const requirementNote = tender.requirementCount
        ? ` ${tender.requirementCount} requirement signal(s) were detected.`
        : '';

    return `${buyer} has published a ${category} tender for ${title}. Closing date: ${closingDate}.${requirementNote}`;
}

function classifyBusinessCategory(tender) {
    const text = [
        tender.title,
        tender.category,
        tender.categoryCode,
        tender.buyer,
        tender.tenderReferenceNumber,
    ]
        .join(' ')
        .toLowerCase();

    if (
        text.includes('construction') ||
        text.includes('civil') ||
        text.includes('building') ||
        text.includes('works') ||
        text.includes('road') ||
        text.includes('bridge')
    ) {
        return 'Construction';
    }

    if (
        text.includes('ict') ||
        text.includes('software') ||
        text.includes('computer') ||
        text.includes('server') ||
        text.includes('network') ||
        text.includes('telecommunication') ||
        text.includes('pabx') ||
        text.includes('system')
    ) {
        return 'ICT';
    }

    if (
        text.includes('medical') ||
        text.includes('hospital') ||
        text.includes('clinic') ||
        text.includes('pharmaceutical') ||
        text.includes('medicine') ||
        text.includes('health')
    ) {
        return 'Medical';
    }

    if (
        text.includes('vehicle') ||
        text.includes('motor') ||
        text.includes('bus') ||
        text.includes('truck') ||
        text.includes('fleet')
    ) {
        return 'Vehicles';
    }

    if (
        text.includes('electricity') ||
        text.includes('power') ||
        text.includes('energy') ||
        text.includes('zetdc') ||
        text.includes('transmission') ||
        text.includes('substation') ||
        text.includes('pipeline') ||
        text.includes('fuel') ||
        text.includes('petroleum')
    ) {
        return 'Energy';
    }

    if (text.includes('security') || text.includes('guard')) {
        return 'Security';
    }

    if (text.includes('cleaning') || text.includes('hygiene') || text.includes('sanitation')) {
        return 'Cleaning';
    }

    if (
        text.includes('office') ||
        text.includes('stationery') ||
        text.includes('furniture') ||
        text.includes('printer')
    ) {
        return 'Office Supplies';
    }

    if (
        text.includes('consultancy') ||
        text.includes('consultant') ||
        text.includes('advisory') ||
        text.includes('training')
    ) {
        return 'Consulting';
    }

    if (
        text.includes('agriculture') ||
        text.includes('seed') ||
        text.includes('fertilizer') ||
        text.includes('farming')
    ) {
        return 'Agriculture';
    }

    if (text.includes('mining') || text.includes('mineral')) {
        return 'Mining';
    }

    if (
        text.includes('transport') ||
        text.includes('logistics') ||
        text.includes('delivery') ||
        text.includes('freight')
    ) {
        return 'Transport';
    }

    return 'Other';
}

function calculateOpportunityScore(tender) {
    let score = 35;

    if (isOpenOrActive(tender.status)) score += 20;

    if (tender.daysRemaining !== null) {
        if (tender.daysRemaining >= 7) score += 15;
        if (tender.daysRemaining >= 14) score += 10;
        if (tender.daysRemaining <= 2) score -= 10;
        if (tender.daysRemaining < 0) score -= 25;
    }

    if (tender.buyer) score += 5;
    if (tender.category) score += 5;
    if (tender.procurementMethod) score += 5;
    if (tender.classOfProcurement) score += 5;
    if (tender.deliveryLocation) score += 3;

    if (tender.bidFormFee === '0') score += 5;
    if (tender.hasPublicDocuments) score += 7;
    if (tender.requirementCount > 0) score += 4;

    if (tender.riskScore >= 70) score -= 15;
    if (tender.riskScore >= 50) score -= 5;

    return Math.max(0, Math.min(score, 100));
}

function getOpportunityRating(score) {
    if (score >= 80) return 'High';
    if (score >= 55) return 'Medium';
    return 'Low';
}

function calculateRiskScore(tender) {
    let score = 15;

    if (tender.daysRemaining !== null) {
        if (tender.daysRemaining <= 2) score += 25;
        else if (tender.daysRemaining <= 5) score += 15;
        else if (tender.daysRemaining <= 10) score += 8;

        if (tender.daysRemaining < 0) score += 30;
    }

    if (tender.bidSecurityRequired) score += 15;
    if (!tender.hasPublicDocuments) score += 8;
    if (!tender.procurementMethod) score += 5;
    if (!tender.classOfProcurement) score += 5;
    if (!tender.deliveryLocation) score += 5;

    const classText = cleanText(tender.classOfProcurement).toLowerCase();
    if (classText.includes('complex')) score += 10;

    const requirementText = [
        ...(tender.mandatoryRequirements || []),
        ...(tender.eligibilityRequirements || []),
        ...(tender.financialRequirements || []),
    ]
        .join(' ')
        .toLowerCase();

    if (requirementText.includes('site visit')) score += 8;
    if (requirementText.includes('samples')) score += 5;
    if (requirementText.includes('experience')) score += 5;

    return Math.max(0, Math.min(score, 100));
}

function getRiskLevel(score) {
    if (score >= 70) return 'High';
    if (score >= 40) return 'Medium';
    return 'Low';
}

function isTenderDocumentLink(link) {
    const text = cleanText(link.text).toLowerCase();
    const href = cleanText(link.href).toLowerCase();

    if (!href) return false;

    const blockedValues = [
        'about egp system',
        'about praz',
        'terms & conditions',
        'privacy policy',
        'home',
        'login',
        'sign up',
        'faq',
        'manuals',
        'announcement',
        'workshops',
        'resources',
        'public reports',
        'supplier registration',
        'tc_policy',
        'cms_documents/tc_policy',
        '/indexes/index',
        '/indexes/login',
        '/suppliers/add',
    ];

    if (blockedValues.some((blocked) => text.includes(blocked) || href.includes(blocked))) {
        return false;
    }

    const looksLikeDocument =
        href.includes('download') ||
        href.includes('privateuploads') ||
        href.includes('uploads') ||
        href.match(/\.(pdf|doc|docx|xls|xlsx|csv|zip)(\?|#|$)/i) ||
        text.includes('document') ||
        text.includes('download') ||
        text.includes('bid document') ||
        text.includes('tender document') ||
        text.includes('boq') ||
        text.includes('specification');

    return Boolean(looksLikeDocument);
}

function getDocumentType(link) {
    const text = cleanText(link.text).toLowerCase();
    const href = cleanText(link.href).toLowerCase();

    if (href.includes('.pdf') || text.includes('pdf')) return 'pdf';
    if (href.includes('.docx')) return 'docx';
    if (href.includes('.doc')) return 'doc';
    if (href.includes('.xlsx')) return 'xlsx';
    if (href.includes('.xls')) return 'xls';
    if (href.includes('.csv')) return 'csv';
    if (href.includes('.zip')) return 'zip';

    return 'unknown';
}

function cleanDocumentLinks(rawDocumentLinks) {
    return rawDocumentLinks
        .map((link) => ({
            text: cleanText(link.text) || 'Tender document',
            href: cleanText(link.href),
        }))
        .filter(isTenderDocumentLink)
        .map((link) => ({
            ...link,
            type: getDocumentType(link),
        }))
        .filter((link, index, array) => {
            return array.findIndex((item) => item.href === link.href) === index;
        });
}

function getFieldFromLines(lines, label) {
    const normalizedLabel = label.toLowerCase();
    const labelRegex = new RegExp(`^${escapeRegex(label)}\\s*:?\\s*`, 'i');

    for (let i = 0; i < lines.length; i++) {
        const line = cleanText(lines[i]);
        const lowerLine = line.toLowerCase();

        if (!lowerLine.startsWith(normalizedLabel)) continue;

        const sameLineValue = cleanText(line.replace(labelRegex, ''));

        if (
            sameLineValue &&
            sameLineValue.toLowerCase() !== normalizedLabel &&
            sameLineValue !== ':'
        ) {
            return sameLineValue;
        }

        for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
            const nextLine = cleanText(lines[j]);

            if (!nextLine) continue;
            if (nextLine.endsWith(':')) continue;
            if (nextLine.toLowerCase() === normalizedLabel) continue;

            return nextLine;
        }
    }

    return null;
}

function uniqueLimited(values, limit = 20) {
    const seen = new Set();
    const output = [];

    for (const value of values) {
        const cleaned = cleanText(value);

        if (!cleaned) continue;

        const key = cleaned.toLowerCase();

        if (seen.has(key)) continue;

        seen.add(key);
        output.push(cleaned);

        if (output.length >= limit) break;
    }

    return output;
}

function getRelevantLines(text, keywords, limit = 20) {
    const lines = String(text || '')
        .split(/\r?\n|\. /)
        .map(cleanText)
        .filter((line) => line.length >= 8 && line.length <= 350);

    return uniqueLimited(
        lines.filter((line) => {
            const lower = line.toLowerCase();
            return keywords.some((keywordItem) => lower.includes(keywordItem));
        }),
        limit,
    );
}

function detectBidSecurityRequired(tender, analysisText) {
    const domestic = cleanText(tender.bidSecurityAmountDomestic).toLowerCase();
    const international = cleanText(tender.bidSecurityAmountInternational).toLowerCase();
    const text = cleanText(analysisText).toLowerCase();

    const hasAmount = [domestic, international].some((value) => {
        if (!value) return false;
        if (value === '0') return false;
        if (value.includes('not required')) return false;
        if (value.includes('n/a')) return false;
        return /\d/.test(value);
    });

    if (hasAmount) return true;

    if (text.includes('bid security') && !text.includes('bid security amount(domestic):')) {
        return true;
    }

    return false;
}

function extractRequirementSignals(text) {
    const sourceText = String(text || '');

    const mandatoryKeywords = [
        'must',
        'shall',
        'required',
        'mandatory',
        'compulsory',
        'valid',
        'certificate',
        'certified',
        'registration',
        'registered',
        'compliance',
    ];

    const eligibilityKeywords = [
        'eligibility',
        'eligible',
        'company registration',
        'tax clearance',
        'vendor number',
        'supplier registration',
        'praz',
        'nssa',
        'vat',
        'zimba',
        'registration certificate',
    ];

    const submissionKeywords = [
        'closing date',
        'submission',
        'submit',
        'bid submission',
        'deadline',
        'sealed',
        'tender box',
        'online',
        'e-gp',
        'egp',
    ];

    const financialKeywords = [
        'bid security',
        'bid bond',
        'bank guarantee',
        'fee',
        'payment',
        'receipt',
        'performance security',
        'advance payment',
    ];

    const technicalKeywords = [
        'specification',
        'boq',
        'bill of quantities',
        'technical',
        'experience',
        'samples',
        'site visit',
        'delivery',
        'warranty',
    ];

    const mandatoryRequirements = getRelevantLines(sourceText, mandatoryKeywords);
    const eligibilityRequirements = getRelevantLines(sourceText, eligibilityKeywords);
    const submissionRequirements = getRelevantLines(sourceText, submissionKeywords);
    const financialRequirements = getRelevantLines(sourceText, financialKeywords);
    const technicalRequirements = getRelevantLines(sourceText, technicalKeywords);

    const lower = sourceText.toLowerCase();

    return {
        mandatoryRequirements,
        eligibilityRequirements,
        submissionRequirements,
        financialRequirements,
        technicalRequirements,
        siteVisitRequired: lower.includes('site visit') || lower.includes('site meeting'),
        requirementCount:
            mandatoryRequirements.length +
            eligibilityRequirements.length +
            submissionRequirements.length +
            financialRequirements.length +
            technicalRequirements.length,
    };
}

async function fetchPublicPdfText(url) {
    if (!url || !url.toLowerCase().includes('.pdf')) {
        return {
            ok: false,
            reason: 'Not a direct PDF URL',
            text: '',
        };
    }

    let controller;

    try {
        controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                Accept: 'application/pdf,*/*',
            },
        });

        clearTimeout(timeout);

        if (!response.ok) {
            return {
                ok: false,
                reason: `HTTP ${response.status}`,
                text: '',
            };
        }

        const contentLength = Number(response.headers.get('content-length') || 0);

        if (contentLength && contentLength > maxPdfBytes) {
            return {
                ok: false,
                reason: `PDF too large: ${contentLength} bytes`,
                text: '',
            };
        }

        const arrayBuffer = await response.arrayBuffer();

        if (arrayBuffer.byteLength > maxPdfBytes) {
            return {
                ok: false,
                reason: `PDF too large: ${arrayBuffer.byteLength} bytes`,
                text: '',
            };
        }

        const pdfParseModule = await import('pdf-parse');
        const pdfParse = pdfParseModule.default || pdfParseModule;

        const parsed = await pdfParse(Buffer.from(arrayBuffer));

        return {
            ok: true,
            reason: 'Parsed',
            text: cleanText(parsed.text).slice(0, documentTextMaxChars),
        };
    } catch (error) {
        return {
            ok: false,
            reason: error?.message || 'PDF extraction failed',
            text: '',
        };
    } finally {
        controller?.abort?.();
    }
}

async function analyzePublicDocuments(documentLinks) {
    if (!analyzeDocuments || maxDocumentsPerTender === 0) {
        return {
            documentAnalysisStatus: 'not_requested',
            documentTextExtracted: false,
            documentAnalysisNotes: [],
            documentText: '',
        };
    }

    const selectedDocuments = documentLinks
        .filter((link) => link.type === 'pdf' || link.href.toLowerCase().includes('.pdf'))
        .slice(0, maxDocumentsPerTender);

    if (selectedDocuments.length === 0) {
        return {
            documentAnalysisStatus: 'no_public_pdf_documents',
            documentTextExtracted: false,
            documentAnalysisNotes: [],
            documentText: '',
        };
    }

    const notes = [];
    const textParts = [];

    for (const documentLink of selectedDocuments) {
        const result = await fetchPublicPdfText(documentLink.href);

        notes.push(`${documentLink.text}: ${result.reason}`);

        if (result.ok && result.text) {
            textParts.push(`Document: ${documentLink.text}\n${result.text}`);
        }
    }

    const documentText = textParts.join('\n\n').slice(0, documentTextMaxChars);

    if (documentText) {
        documentAnalysisSuccessCount++;
    } else {
        documentAnalysisFailedCount++;
    }

    return {
        documentAnalysisStatus: documentText ? 'success' : 'failed_or_unavailable',
        documentTextExtracted: Boolean(documentText),
        documentAnalysisNotes: notes,
        documentText,
    };
}

function buildTenderDocumentSummary(tender) {
    if (!tender.hasPublicDocuments) {
        return 'No public tender document links were detected on the detail page.';
    }

    const types = uniqueLimited(tender.documentLinks.map((documentLink) => documentLink.type), 10)
        .filter(Boolean)
        .join(', ');

    if (tender.documentTextExtracted) {
        return `Found ${tender.documentCount} public document link(s). Extracted readable text from public PDF document(s). Document types: ${types || 'unknown'}.`;
    }

    return `Found ${tender.documentCount} public document link(s). Document types: ${types || 'unknown'}. Text extraction was not requested or no readable public PDF was available.`;
}

function buildReadinessChecklist(tender) {
    const checklist = [];

    if (tender.bidSecurityRequired) {
        checklist.push('Prepare bid security or bank guarantee if applicable.');
    }

    if (tender.siteVisitRequired) {
        checklist.push('Confirm site visit / site meeting details before bidding.');
    }

    if (tender.bidFormFee && tender.bidFormFee !== '0') {
        checklist.push(`Confirm payment of bid form fee: ${tender.bidFormFee}.`);
    }

    if (tender.daysRemaining !== null && tender.daysRemaining <= 5) {
        checklist.push('Treat as urgent because the closing date is close.');
    }

    if (tender.documentCount > 0) {
        checklist.push('Review all public tender documents and specifications.');
    } else {
        checklist.push('Check the source portal for tender documents or access requirements.');
    }

    checklist.push('Verify company registration, tax/compliance documents, and supplier registration requirements.');

    return checklist;
}

async function extractTenderRowsFromPage(page) {
    const rows = await page.$$eval('tr', (tableRows) =>
        tableRows.map((row) => {
            const cells = Array.from(row.querySelectorAll('th, td')).map((cell) =>
                cell.innerText.replace(/\s+/g, ' ').trim(),
            );

            const link = row.querySelector('a[href*="viewLiveTenderDetails"]');

            return {
                cells,
                href: link ? link.href : null,
            };
        }),
    );

    return rows.filter((row) => {
        const firstCell = row.cells?.[0] || '';
        return /^\d+$/.test(firstCell) && row.cells.length >= 8;
    });
}

async function getFirstTenderIdOnPage(page) {
    return page
        .$$eval('tr', (tableRows) => {
            for (const row of tableRows) {
                const cells = Array.from(row.querySelectorAll('th, td')).map((cell) =>
                    cell.innerText.replace(/\s+/g, ' ').trim(),
                );

                if (/^\d+$/.test(cells[0] || '')) {
                    return cells[0];
                }
            }

            return null;
        })
        .catch(() => null);
}

async function goToNextResultsPage(page) {
    const firstTenderIdBefore = await getFirstTenderIdOnPage(page);

    const clicked = await page.evaluate(() => {
        function isDisabled(element) {
            const className = String(element.className || '').toLowerCase();
            const ariaDisabled = element.getAttribute('aria-disabled');

            return (
                className.includes('disabled') ||
                ariaDisabled === 'true' ||
                element.disabled ||
                Boolean(element.closest('.disabled'))
            );
        }

        const selectors = [
            'a.paginate_button.next:not(.disabled)',
            'li.paginate_button.next:not(.disabled) a',
            '.dataTables_paginate .next:not(.disabled) a',
            '.dataTables_paginate .next:not(.disabled)',
            'a[aria-label="Next"]:not(.disabled)',
            'button[aria-label="Next"]:not(.disabled)',
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);

            if (element && !isDisabled(element)) {
                element.scrollIntoView({ block: 'center' });
                element.click();
                return true;
            }
        }

        const candidates = Array.from(document.querySelectorAll('a, button'));

        const nextElement = candidates.find((element) => {
            const text = String(element.textContent || '').trim().toLowerCase();
            const ariaLabel = String(element.getAttribute('aria-label') || '').trim().toLowerCase();

            return (
                !isDisabled(element) &&
                (text === 'next' || text.includes('next') || ariaLabel === 'next')
            );
        });

        if (nextElement) {
            nextElement.scrollIntoView({ block: 'center' });
            nextElement.click();
            return true;
        }

        return false;
    });

    if (!clicked) return false;

    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);

    if (firstTenderIdBefore) {
        await page
            .waitForFunction(
                (oldFirstTenderId) => {
                    const rows = Array.from(document.querySelectorAll('tr'));

                    for (const row of rows) {
                        const cells = Array.from(row.querySelectorAll('th, td')).map((cell) =>
                            cell.innerText.replace(/\s+/g, ' ').trim(),
                        );

                        if (/^\d+$/.test(cells[0] || '')) {
                            return cells[0] !== oldFirstTenderId;
                        }
                    }

                    return false;
                },
                firstTenderIdBefore,
                { timeout: 10000 },
            )
            .catch(() => {});
    }

    const firstTenderIdAfter = await getFirstTenderIdOnPage(page);

    return Boolean(firstTenderIdAfter && firstTenderIdAfter !== firstTenderIdBefore);
}

function buildListTenderFromCells(cells, href) {
    const tenderId = cleanText(cells[0]);

    return {
        country: 'Zimbabwe',
        source: 'PRAZ eGP',

        tenderId,
        tenderReferenceNumber: cleanText(cells[1]),
        title: cleanText(cells[2]),
        categoryCode: cleanText(cells[3]),
        category: cleanText(cells[4]),
        buyer: cleanText(cells[5]),
        status: cleanText(cells[6]),
        publishDate: cleanText(cells[7]),
        closingDate: cleanText(cells[8]),

        procurementMethod: null,
        classOfProcurement: null,
        deliveryLocation: null,

        bidFormFee: null,
        bidSecurityAmountDomestic: null,
        bidSecurityAmountInternational: null,

        documentLinks: [],
        documentCount: 0,
        documentUrls: '',
        documentTitles: '',
        hasPublicDocuments: false,

        sourceUrl: href || `https://egp.praz.org.zw/Indexes/viewLiveTenderDetails/${tenderId}`,
        scrapedAt: new Date().toISOString(),
    };
}

function applyMemoryFields(tender) {
    const memoryKey = tender.tenderId || tender.sourceUrl;
    const existing = tenderMemory[memoryKey] || null;

    tender.isNew = !existing;
    tender.firstSeenAt = existing?.firstSeenAt || runStartedAt;
    tender.lastSeenAt = runStartedAt;
    tender.previousStatus = existing?.lastStatus || null;
    tender.statusChanged = Boolean(existing && existing.lastStatus && existing.lastStatus !== tender.status);
    tender.alertReason = tender.isNew
        ? 'New tender discovered'
        : tender.statusChanged
          ? `Tender status changed from ${existing.lastStatus} to ${tender.status}`
          : '';

    return tender;
}

function rememberTender(tender) {
    const memoryKey = tender.tenderId || tender.sourceUrl;

    tenderMemory[memoryKey] = {
        tenderId: tender.tenderId,
        tenderReferenceNumber: tender.tenderReferenceNumber,
        title: tender.title,
        buyer: tender.buyer,
        lastStatus: tender.status,
        sourceUrl: tender.sourceUrl,
        firstSeenAt: tender.firstSeenAt || runStartedAt,
        lastSeenAt: runStartedAt,
    };
}

function enrichTender(tender) {
    tender.daysRemaining = calculateDaysRemaining(tender.closingDate);
    tender.closingDateIso = toIsoDate(tender.closingDate);
    tender.publishDateIso = toIsoDate(tender.publishDate);

    tender.businessCategory = classifyBusinessCategory(tender);

    tender.documentCount = Array.isArray(tender.documentLinks) ? tender.documentLinks.length : 0;
    tender.hasPublicDocuments = tender.documentCount > 0;
    tender.documentUrls = tender.hasPublicDocuments
        ? tender.documentLinks.map((doc) => doc.href).join(' | ')
        : '';
    tender.documentTitles = tender.hasPublicDocuments
        ? tender.documentLinks.map((doc) => doc.text).join(' | ')
        : '';

    tender.bidSecurityRequired = Boolean(tender.bidSecurityRequired);

    tender.riskScore = calculateRiskScore(tender);
    tender.riskLevel = getRiskLevel(tender.riskScore);

    tender.opportunityScore = calculateOpportunityScore(tender);
    tender.opportunityRating = getOpportunityRating(tender.opportunityScore);

    tender.tenderDocumentSummary = buildTenderDocumentSummary(tender);
    tender.readinessChecklist = buildReadinessChecklist(tender);
    tender.summary = buildSummary(tender);

    applyMemoryFields(tender);

    return tender;
}

const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: maxItems + maxPages + 40,
    requestHandlerTimeoutSecs: analyzeDocuments ? 180 : 120,
    maxConcurrency: analyzeDocuments ? 2 : 4,

    launchContext: {
        launchOptions: {
            headless: true,
        },
    },

    preNavigationHooks: [
        async ({ page }, gotoOptions) => {
            gotoOptions.waitUntil = 'networkidle';
            gotoOptions.timeout = 60000;

            await page.setExtraHTTPHeaders({
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                Accept:
                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            });
        },
    ],

    async requestHandler({ page, request, enqueueLinks }) {
        const label = request.userData.label || 'LIST';

        log.info(`Processing ${label}: ${request.url}`);

        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2500);

        if (label === 'DETAIL') {
            const listData = request.userData.listData || {};

            const bodyText = await page.locator('body').innerText().catch(() => '');
            const lines = bodyText
                .split(/\r?\n/)
                .map(cleanText)
                .filter(Boolean);

            const rawDocumentLinks = await page.$$eval('a', (anchors) =>
                anchors.map((a) => ({
                    text: a.innerText.trim(),
                    href: a.href,
                })),
            );

            const documentLinks = cleanDocumentLinks(rawDocumentLinks);
            const documentAnalysis = await analyzePublicDocuments(documentLinks);

            const requirementSourceText = [
                bodyText,
                documentAnalysis.documentText,
            ].join('\n\n');

            const requirementSignals = extractRequirements
                ? extractRequirementSignals(requirementSourceText)
                : {
                      mandatoryRequirements: [],
                      eligibilityRequirements: [],
                      submissionRequirements: [],
                      financialRequirements: [],
                      technicalRequirements: [],
                      siteVisitRequired: false,
                      requirementCount: 0,
                  };

            const tenderBase = {
                country: 'Zimbabwe',
                source: 'PRAZ eGP',

                tenderId:
                    listData.tenderId ||
                    getFieldFromLines(lines, 'Tender Id'),

                tenderReferenceNumber:
                    listData.tenderReferenceNumber ||
                    getFieldFromLines(lines, 'Tender Reference Number'),

                title:
                    listData.title ||
                    getFieldFromLines(lines, 'Project Name') ||
                    getFieldFromLines(lines, 'Tender Title'),

                categoryCode: listData.categoryCode || null,

                category:
                    listData.category ||
                    getFieldFromLines(lines, 'Required Supplier Categories'),

                buyer:
                    listData.buyer ||
                    getFieldFromLines(lines, 'Procuring Entity'),

                status:
                    listData.status ||
                    getFieldFromLines(lines, 'Status'),

                publishDate:
                    listData.publishDate ||
                    getFieldFromLines(lines, 'Published Date') ||
                    getFieldFromLines(lines, 'Date created'),

                closingDate:
                    listData.closingDate ||
                    getFieldFromLines(lines, 'Closing Date') ||
                    getFieldFromLines(lines, 'Bid Submission Closing Date'),

                procurementMethod: normalizeEmptyValue(
                    getFieldFromLines(lines, 'Procurement Method'),
                    'Procurement Method',
                ),

                classOfProcurement: normalizeEmptyValue(
                    getFieldFromLines(lines, 'Class of Procurement'),
                    'Class of Procurement',
                ),

                deliveryLocation: normalizeEmptyValue(
                    getFieldFromLines(lines, 'Delivery/Project Location'),
                    'Delivery/Project Location',
                ),

                bidFormFee: normalizeEmptyValue(
                    getFieldFromLines(lines, 'Bid Form Fee'),
                    'Bid Form Fee',
                ),

                bidSecurityAmountDomestic: normalizeEmptyValue(
                    getFieldFromLines(lines, 'Bid Security Amount(Domestic)'),
                    'Bid Security Amount(Domestic)',
                ),

                bidSecurityAmountInternational: normalizeEmptyValue(
                    getFieldFromLines(lines, 'Bid Security Amount(International)'),
                    'Bid Security Amount(International)',
                ),

                documentLinks,

                ...documentAnalysis,
                ...requirementSignals,

                sourceUrl: request.url,
                scrapedAt: new Date().toISOString(),
            };

            tenderBase.bidSecurityRequired = detectBidSecurityRequired(
                tenderBase,
                requirementSourceText,
            );

            const tender = enrichTender(tenderBase);

            if (!shouldKeepTender(tender)) {
                skippedByFilterCount++;
                log.info(`Skipped tender ${tender.tenderId}: did not match filters.`);
                rememberTender(tender);
                return;
            }

            if (newOnly && !tender.isNew && !tender.statusChanged) {
                skippedExistingCount++;
                log.info(`Skipped tender ${tender.tenderId}: already seen before.`);
                rememberTender(tender);
                return;
            }

            if (savedCount >= maxItems) {
                log.info(`Skipped tender ${tender.tenderId}: maxItems limit reached.`);
                rememberTender(tender);
                return;
            }

            await Actor.pushData(tender);
            rememberTender(tender);
            savedCount++;

            log.info(
                `Saved tender ${savedCount}: ${tender.tenderId} - ${
                    tender.tenderReferenceNumber || tender.title
                } | Score: ${tender.opportunityScore} | Risk: ${tender.riskLevel}`,
            );

            return;
        }

        const pageTitle = await page.title();
        log.info(`Page title: ${pageTitle}`);
        log.info(`Scraping up to ${maxPages} page(s), max ${maxItems} item(s).`);

        let totalRowsFound = 0;

        for (let currentPage = 1; currentPage <= maxPages; currentPage++) {
            if (includeDetails && queuedCount >= maxItems) break;
            if (!includeDetails && savedCount >= maxItems) break;

            const tenderRows = await extractTenderRowsFromPage(page);
            totalRowsFound += tenderRows.length;

            log.info(`Page ${currentPage}: found ${tenderRows.length} tender rows.`);

            for (const row of tenderRows) {
                if (includeDetails && queuedCount >= maxItems) break;
                if (!includeDetails && savedCount >= maxItems) break;

                const listTender = buildListTenderFromCells(row.cells, row.href);

                if (!listTender.tenderId) continue;

                if (seenTenderIdsThisRun.has(listTender.tenderId)) {
                    log.info(`Skipped duplicate tender ID: ${listTender.tenderId}`);
                    continue;
                }

                seenTenderIdsThisRun.add(listTender.tenderId);

                if (!shouldQueueListTender(listTender)) {
                    skippedByFilterCount++;
                    log.info(`Skipped tender ${listTender.tenderId}: did not match list filters.`);
                    continue;
                }

                const detailUrl =
                    row.href ||
                    `https://egp.praz.org.zw/Indexes/viewLiveTenderDetails/${listTender.tenderId}`;

                if (!includeDetails) {
                    const tender = enrichTender(listTender);

                    if (!shouldKeepTender(tender)) {
                        skippedByFilterCount++;
                        log.info(`Skipped tender ${tender.tenderId}: did not match final filters.`);
                        rememberTender(tender);
                        continue;
                    }

                    if (newOnly && !tender.isNew && !tender.statusChanged) {
                        skippedExistingCount++;
                        log.info(`Skipped tender ${tender.tenderId}: already seen before.`);
                        rememberTender(tender);
                        continue;
                    }

                    await Actor.pushData(tender);
                    rememberTender(tender);
                    savedCount++;

                    log.info(
                        `Saved list tender ${savedCount}: ${tender.tenderId} - ${
                            tender.tenderReferenceNumber || tender.title
                        }`,
                    );

                    continue;
                }

                if (queuedDetailUrls.has(detailUrl)) {
                    log.info(`Skipped duplicate detail URL: ${detailUrl}`);
                    continue;
                }

                queuedDetailUrls.add(detailUrl);

                await enqueueLinks({
                    urls: [detailUrl],
                    label: 'DETAIL',
                    userData: {
                        listData: listTender,
                    },
                });

                queuedCount++;

                log.info(`Queued detail page ${queuedCount}: ${detailUrl}`);
            }

            if (currentPage >= maxPages) break;

            const movedToNextPage = await goToNextResultsPage(page);

            if (!movedToNextPage) {
                log.info(`No next page found after page ${currentPage}. Pagination stopped.`);
                break;
            }
        }

        await Actor.setValue('OUTPUT', {
            message: includeDetails
                ? `Queued ${queuedCount} tender detail page(s) from ${totalRowsFound} discovered row(s).`
                : `Saved ${savedCount} tender row(s) from ${totalRowsFound} discovered row(s).`,
            totalRowsFound,
            totalQueued: queuedCount,
            totalSaved: savedCount,
            skippedExistingCount,
            skippedByFilterCount,
            maxItems,
            maxPages,
            includeDetails,
            newOnly,
            analyzeDocuments,
            extractRequirements,
            filters: {
                keyword,
                buyerKeyword,
                categoryKeyword,
                statusKeyword,
                procurementMethodKeyword,
                classOfProcurementKeyword,
                businessCategory: businessCategoryFilter,
                onlyOpen,
                minimumDaysRemaining,
                maximumDaysRemaining,
            },
            scrapedAt: new Date().toISOString(),
        });
    },

    failedRequestHandler({ request, error }) {
        log.error(`Request failed: ${request.url}`);
        log.error(error?.message || error);
    },
});

await crawler.run([
    {
        url: startUrl,
        userData: {
            label: 'LIST',
        },
    },
]);

await memoryStore.setValue('SEEN_TENDERS', tenderMemory);

await Actor.setValue('OUTPUT', {
    message: `Scraped ${savedCount} enriched tender(s) from PRAZ eGP.`,
    totalSaved: savedCount,
    totalQueued: queuedCount,
    skippedExistingCount,
    skippedByFilterCount,
    documentAnalysisSuccessCount,
    documentAnalysisFailedCount,
    maxItems,
    maxPages,
    includeDetails,
    newOnly,
    analyzeDocuments,
    extractRequirements,
    memoryStoreName,
    filters: {
        keyword,
        buyerKeyword,
        categoryKeyword,
        statusKeyword,
        procurementMethodKeyword,
        classOfProcurementKeyword,
        businessCategory: businessCategoryFilter,
        onlyOpen,
        minimumDaysRemaining,
        maximumDaysRemaining,
    },
    scrapedAt: new Date().toISOString(),
});

await Actor.exit();
