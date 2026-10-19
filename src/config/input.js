import { createFilters } from '../utils/filters.js';

function integer(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(number)));
}

export function parseInput(input = {}) {
    const config = {
        startUrl: input.startUrl || 'https://egp.praz.org.zw/Indexes/index',
        maxItems: integer(input.maxItems, 50, 1, 1000),
        maxPages: integer(input.maxPages, 1, 1, 100),
        includeDetails: input.includeDetails !== false,
        filters: createFilters(input),
        newOnly: Boolean(input.newOnly),
        detectChanges: input.detectChanges !== false,
        includeStatusChanges: input.includeStatusChanges !== false,
        stateStoreId: String(input.stateStoreId || '').trim(),
        resetSeenTenders: Boolean(input.resetSeenTenders),
        extractRequirements: input.extractRequirements !== false,
        analyzeDocuments: Boolean(input.analyzeDocuments),
        maxDocumentsPerTender: integer(input.maxDocumentsPerTender, 2, 0, 10),
        maxDocumentSizeMB: integer(
            input.maxDocumentSizeMB ??
                (Number(input.maxPdfBytes) > 0 ? Math.ceil(Number(input.maxPdfBytes) / (1024 * 1024)) : 10),
            10,
            1,
            50,
        ),
        documentTextMaxChars: integer(input.documentTextMaxChars, 12_000, 1000, 100_000),
    };

    try {
        const url = new URL(config.startUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('startUrl must use HTTP or HTTPS');
    } catch (error) {
        throw new Error(`Invalid startUrl: ${error.message}`);
    }

    if (config.newOnly && !config.stateStoreId) {
        throw new Error('newOnly requires an explicit stateStoreId so monitoring history is isolated per customer.');
    }
    if (config.resetSeenTenders && !config.stateStoreId) {
        throw new Error('resetSeenTenders requires an explicit stateStoreId.');
    }

    return config;
}

export { integer };
