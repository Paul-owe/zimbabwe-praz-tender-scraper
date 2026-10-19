import { createHash } from 'node:crypto';

import { Actor } from 'apify';

const STATE_KEY = 'SEEN_TENDERS_V4';

export function createMemoryState() {
    return {
        enabled: false,
        storeId: null,
        records: {},
        pending: new Map(),
        get(tenderId) {
            return this.records[tenderId] || null;
        },
        record(tender) {
            const key = tender.tenderId || tender.sourceUrl;
            this.records[key] = {
                tenderId: tender.tenderId,
                lastStatus: tender.status,
                lastClosingDate: tender.closingDateIso || tender.closingDate || null,
                fingerprint: createTenderFingerprint(tender),
                firstSeenAt: tender.firstSeenAt,
                lastSeenAt: tender.lastSeenAt,
            };
        },
        async flush() {
            return undefined;
        },
    };
}

export async function openPersistentState(stateStoreId, options = {}) {
    const id = String(stateStoreId || '').trim();
    if (!id) return createMemoryState();

    const store = options.store || (await Actor.openKeyValueStore(id));
    let records = {};
    try {
        const stored = await store.getValue(STATE_KEY);
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) records = stored;
    } catch {
        records = {};
    }

    return {
        enabled: true,
        storeId: id,
        records,
        pending: new Map(),
        get(tenderId) {
            return this.records[tenderId] || null;
        },
        record(tender) {
            const key = tender.tenderId || tender.sourceUrl;
            const previous = this.records[key];
            this.records[key] = {
                tenderId: tender.tenderId,
                tenderReferenceNumber: tender.tenderReferenceNumber,
                title: tender.title,
                buyer: tender.buyer,
                lastStatus: tender.status,
                lastClosingDate: tender.closingDateIso || tender.closingDate || null,
                fingerprint: createTenderFingerprint(tender),
                firstSeenAt: previous?.firstSeenAt || tender.firstSeenAt,
                lastSeenAt: tender.lastSeenAt,
            };
        },
        async flush() {
            let remoteRecords = {};
            try {
                const remote = await store.getValue(STATE_KEY);
                if (remote && typeof remote === 'object' && !Array.isArray(remote)) remoteRecords = remote;
            } catch {
                remoteRecords = {};
            }
            for (const [key, remoteRecord] of Object.entries(remoteRecords)) {
                const localRecord = this.records[key];
                if (!localRecord || String(remoteRecord.lastSeenAt || '') > String(localRecord.lastSeenAt || '')) {
                    this.records[key] = remoteRecord;
                }
            }
            await store.setValue(STATE_KEY, this.records, { contentType: 'application/json' });
        },
        async reset() {
            this.records = {};
            await store.setValue(STATE_KEY, {});
        },
    };
}

export function createTenderFingerprint(tender) {
    const material = [
        tender.tenderId,
        tender.tenderReferenceNumber,
        tender.title,
        tender.buyer,
        tender.category,
        tender.status,
        tender.closingDateIso || tender.closingDate,
        tender.procurementMethod,
        tender.classOfProcurement,
        tender.deliveryLocation,
        tender.bidFormFee,
        tender.bidSecurityAmountDomestic,
        tender.bidSecurityAmountInternational,
        ...(tender.mandatoryRequirements || []).map((value) => JSON.stringify(value)),
        ...(tender.eligibilityRequirements || []).map((value) => JSON.stringify(value)),
        ...(tender.submissionRequirements || []).map((value) => JSON.stringify(value)),
        ...(tender.financialRequirements || []).map((value) => JSON.stringify(value)),
        ...(tender.technicalRequirements || []).map((value) => JSON.stringify(value)),
    ]
        .map((value) =>
            String(value ?? '')
                .trim()
                .toLowerCase(),
        )
        .join('|');

    return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

export function applyMonitoringFields(tender, state, now = new Date().toISOString()) {
    if (!state.enabled) {
        return {
            ...tender,
            isNew: null,
            firstSeenAt: null,
            lastSeenAt: now,
            previousStatus: null,
            statusChanged: false,
            closingDateChanged: false,
            hasChanges: false,
            alertReason: 'NONE',
        };
    }
    const key = tender.tenderId || tender.sourceUrl;
    const previous = state.get ? state.get(key) : state.records?.[key];
    const fingerprint = createTenderFingerprint(tender);
    const isNew = !previous;
    const statusChanged = Boolean(previous && previous.lastStatus !== null && previous.lastStatus !== tender.status);
    const closingDateChanged = Boolean(
        previous && previous.lastClosingDate !== (tender.closingDateIso || tender.closingDate || null),
    );
    const materialChanged = Boolean(previous && previous.fingerprint && previous.fingerprint !== fingerprint);

    let alertReason = 'NONE';
    if (isNew) alertReason = 'NEW_TENDER';
    else if (statusChanged) alertReason = 'STATUS_CHANGED';
    else if (closingDateChanged) alertReason = 'CLOSING_DATE_CHANGED';
    else if (materialChanged) alertReason = 'TENDER_UPDATED';
    return {
        ...tender,
        isNew,
        firstSeenAt: previous?.firstSeenAt || now,
        lastSeenAt: now,
        previousStatus: previous?.lastStatus ?? null,
        statusChanged,
        closingDateChanged,
        hasChanges: statusChanged || closingDateChanged || materialChanged,
        alertReason,
    };
}

export function shouldEmitTender(tender, { newOnly = false, detectChanges = true, includeStatusChanges = true } = {}) {
    if (!newOnly) return true;
    if (tender.isNew) return true;
    if (!detectChanges) return false;
    if (tender.alertReason === 'STATUS_CHANGED') return includeStatusChanges;
    return tender.hasChanges;
}
