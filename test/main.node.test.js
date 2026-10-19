import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildListTenderFromCells } from '../src/crawlers/listing.js';
import { parseDetailTender } from '../src/crawlers/tender-details.js';
import { analyzePublicDocuments, fetchPublicPdfText } from '../src/services/document-analyzer.js';
import {
    applyMonitoringFields,
    createTenderFingerprint,
    openPersistentState,
    shouldEmitTender,
} from '../src/services/persistent-state.js';
import { extractBidSecurity, extractRequirementSignals } from '../src/services/requirements-extractor.js';
import { calculateOpportunity, calculateRisk } from '../src/services/scoring.js';
import { calculateDaysRemaining, parsePrazDate, toIsoDate } from '../src/utils/dates.js';
import { createFilters, matchesTenderFilters } from '../src/utils/filters.js';

const now = new Date('2026-10-19T07:00:00.000Z');
const baseTender = (overrides = {}) => ({
    tenderId: '100',
    tenderReferenceNumber: 'REF/100',
    title: 'ICT network equipment',
    categoryCode: 'ICT',
    category: 'Information Technology',
    buyer: 'ZETDC',
    status: 'Open',
    closingDate: '25-Oct-2026 10:00 AM',
    closingDateIso: '2026-10-25T08:00:00.000Z',
    sourceUrl: 'https://egp.praz.org.zw/Indexes/viewLiveTenderDetails/100',
    ...overrides,
});

test('PRAZ date normalization uses Zimbabwe UTC+02:00', () => {
    assert.equal(toIsoDate('19-Oct-2026 10:00 AM'), '2026-10-19T08:00:00.000Z');
    assert.equal(parsePrazDate('19-Oct-2026 10:00 AM').toISOString(), '2026-10-19T08:00:00.000Z');
    assert.equal(calculateDaysRemaining('25-Oct-2026 10:00 AM', now), 7);
});

test('filters match keyword, buyer, category, open status, and remaining days', () => {
    const filters = createFilters({
        keyword: 'network',
        buyerKeyword: 'zetdc',
        categoryKeyword: 'ict',
        onlyOpen: true,
        minimumDaysRemaining: 5,
        maximumDaysRemaining: 10,
    });
    assert.equal(matchesTenderFilters({ ...baseTender(), daysRemaining: 6 }, filters), true);
    assert.equal(matchesTenderFilters({ ...baseTender(), status: 'Closed', daysRemaining: 6 }, filters), false);
    assert.throws(() => createFilters({ minimumDaysRemaining: 10, maximumDaysRemaining: 5 }), /minimumDaysRemaining/);
});

test('listing and detail parsers preserve stable IDs and avoid label values', () => {
    const list = buildListTenderFromCells(
        ['100', 'REF', 'Tender', 'ICT', 'ICT', 'Buyer', 'Open', '1-Oct-2026', '25-Oct-2026'],
        'https://egp.praz.org.zw/Indexes/viewLiveTenderDetails/100',
    );
    assert.equal(list.tenderId, '100');
    const detail = parseDetailTender({
        lines: [
            'Tender Id: 100',
            'Project Name: Network upgrade',
            'Bid Security Amount(Domestic): Bid Security Amount(Domestic)',
        ],
        listData: { tenderId: '100' },
        sourceUrl: list.sourceUrl,
    });
    assert.equal(detail.title, 'Network upgrade');
    assert.equal(detail.bidSecurityAmountDomestic, null);
});

test('monitoring distinguishes new, unchanged, status, and closing-date changes', () => {
    const state = {
        enabled: true,
        records: {},
        get(id) {
            return this.records[id] || null;
        },
        record(item) {
            this.records[item.tenderId] = {
                lastStatus: item.status,
                lastClosingDate: item.closingDateIso,
                fingerprint: createTenderFingerprint(item),
                firstSeenAt: item.firstSeenAt,
                lastSeenAt: item.lastSeenAt,
            };
        },
    };
    const first = applyMonitoringFields(baseTender(), state, '2026-10-19T09:00:00.000Z');
    assert.equal(first.alertReason, 'NEW_TENDER');
    state.record(first);
    const unchanged = applyMonitoringFields(baseTender(), state, '2026-10-20T09:00:00.000Z');
    assert.equal(unchanged.alertReason, 'NONE');
    const status = applyMonitoringFields(baseTender({ status: 'Closed' }), state, '2026-10-21T09:00:00.000Z');
    assert.equal(status.alertReason, 'STATUS_CHANGED');
    const closing = applyMonitoringFields(
        baseTender({ closingDateIso: '2026-10-26T08:00:00.000Z' }),
        state,
        '2026-10-21T09:00:00.000Z',
    );
    assert.equal(closing.alertReason, 'CLOSING_DATE_CHANGED');
    assert.equal(shouldEmitTender(unchanged, { newOnly: true, detectChanges: true }), false);
    assert.equal(shouldEmitTender(status, { newOnly: true, detectChanges: true, includeStatusChanges: true }), true);
});

test('persistent state recovers gracefully from corrupted data', async () => {
    const state = await openPersistentState('customer-store', {
        store: {
            async getValue() {
                return '{bad';
            },
            async setValue() {
                return undefined;
            },
        },
    });
    assert.deepEqual(state.records, {});
});

test('requirements extraction returns explicit evidence only', () => {
    const result = extractRequirementSignals({
        detailText:
            'The bidder must submit a valid tax clearance certificate. A bank guarantee is required. The supplier shall provide previous project experience. Optional briefing available.',
        sourceUrl: 'https://egp.praz.org.zw/Indexes/viewLiveTenderDetails/100',
    });
    assert.ok(result.mandatoryRequirements.some((item) => /tax clearance/i.test(item)));
    assert.ok(result.financialRequirements.some((item) => /bank guarantee/i.test(item)));
    assert.ok(result.technicalRequirements.some((item) => /previous project/i.test(item)));
    assert.equal(
        result.eligibilityRequirementEvidence.some((item) => /vat/i.test(item.requirement)),
        false,
    );
});

test('bid security uses null for unknown and extracts explicit type/amount', () => {
    assert.equal(extractBidSecurity({}, '').bidSecurityRequired, null);
    const result = extractBidSecurity({}, 'A bid security of USD 5,000 in the form of a bank guarantee is required.');
    assert.equal(result.bidSecurityRequired, true);
    assert.equal(result.bidSecurityType, 'Bank guarantee');
    assert.equal(result.bidSecurityCurrency, 'USD');
    assert.match(result.bidSecurityAmount, /5,000/);
});

function response(body, headers = { 'content-type': 'application/pdf' }, ok = true, status = 200) {
    return {
        ok,
        status,
        headers: { get: (key) => headers[key] },
        async arrayBuffer() {
            return Buffer.from(body);
        },
    };
}

test('document analysis handles valid, wrong-type, oversized, and HTTP-error documents', async () => {
    const parsed = await fetchPublicPdfText('https://egp.praz.org.zw/uploads/tender.pdf', {
        fetchImpl: async () => response('%PDF-1.7 body'),
        parsePdf: async () => 'Valid requirement text',
    });
    assert.equal(parsed.ok, true);
    const wrongType = await fetchPublicPdfText('https://egp.praz.org.zw/uploads/tender.pdf', {
        fetchImpl: async () => response('not pdf', { 'content-type': 'text/html' }),
    });
    assert.equal(wrongType.reason, 'Response is not a PDF');
    const oversized = await fetchPublicPdfText('https://egp.praz.org.zw/uploads/tender.pdf', {
        maxBytes: 2,
        fetchImpl: async () => response('%PDF-1.7 body'),
    });
    assert.equal(oversized.ok, false);
    const httpError = await fetchPublicPdfText('https://egp.praz.org.zw/uploads/tender.pdf', {
        fetchImpl: async () => response('', {}, false, 404),
    });
    assert.equal(httpError.reason, 'HTTP 404');
});

test('document analysis continues after one failure', async () => {
    const result = await analyzePublicDocuments(
        [
            { text: 'a.pdf', href: 'https://egp.praz.org.zw/uploads/a.pdf', type: 'pdf' },
            { text: 'b.pdf', href: 'https://egp.praz.org.zw/uploads/b.pdf', type: 'pdf' },
        ],
        {
            analyzeDocuments: true,
            fetchPdf: async (url) =>
                url.endsWith('a.pdf') ? { ok: true, text: 'A text' } : { ok: false, reason: 'corrupt', text: '' },
        },
    );
    assert.equal(result.documentAnalysisStatus, 'PARTIAL');
    assert.equal(result.documentsAnalyzed, 2);
    assert.equal(result.documentAnalysisErrors.length, 1);
});

test('risk and opportunity scores are bounded and explain expired deadlines', () => {
    const risk = calculateRisk(baseTender({ daysRemaining: -1, bidSecurityRequired: true, siteVisitRequired: true }));
    const opportunity = calculateOpportunity(baseTender({ daysRemaining: -1, riskScore: risk.riskScore }));
    assert.ok(risk.riskScore >= 0 && risk.riskScore <= 100);
    assert.ok(risk.riskFactors.some((item) => item.factor === 'Expired closing deadline'));
    assert.ok(opportunity.opportunityScore >= 0 && opportunity.opportunityScore <= 100);
    assert.ok(opportunity.opportunityFactors.some((item) => item.factor === 'Expired deadline'));
});

test('dataset schema uses the valid fields object shape and required views', () => {
    const schema = JSON.parse(readFileSync(new URL('../.actor/dataset_schema.json', import.meta.url)));
    assert.equal(schema.fields.type, 'object');
    assert.equal(schema.fields.title, 'Zimbabwe PRAZ tender item');
    for (const view of ['overview', 'bidDetails', 'requirements', 'opportunity', 'alerts'])
        assert.ok(schema.views[view]);
});
