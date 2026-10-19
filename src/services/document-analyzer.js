import { PDFParse } from 'pdf-parse';

import { cleanText, uniqueBy } from '../utils/text.js';

const TRUSTED_HOSTS = ['egp.praz.org.zw', 'praz.org.zw'];

export function isTrustedPublicUrl(value) {
    try {
        const url = new URL(value);
        return (
            url.protocol === 'https:' &&
            TRUSTED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
        );
    } catch {
        return false;
    }
}

export function isTenderDocumentLink(link) {
    const text = cleanText(link?.text).toLowerCase();
    const href = cleanText(link?.href);
    const lowerHref = href.toLowerCase();
    if (!href || !isTrustedPublicUrl(href)) return false;

    const blocked = [
        'about egp system',
        'about praz',
        'terms & conditions',
        'privacy policy',
        'supplier registration',
        'public reports',
        'announcement',
        'workshops',
        'manuals',
        'tc_policy',
        '/indexes/index',
        '/indexes/login',
        '/suppliers/add',
    ];
    if (blocked.some((value) => text.includes(value) || lowerHref.includes(value))) return false;

    return Boolean(
        lowerHref.includes('download') ||
        lowerHref.includes('privateuploads') ||
        lowerHref.includes('uploads') ||
        /\.(pdf|doc|docx|xls|xlsx|csv|zip)(?:[?#]|$)/i.test(lowerHref) ||
        /document|download|bid document|tender document|boq|specification/i.test(text),
    );
}

export function getDocumentType(link) {
    const text = cleanText(link?.text).toLowerCase();
    const href = cleanText(link?.href).toLowerCase();
    if (href.includes('.pdf') || text.includes('pdf')) return 'pdf';
    if (href.includes('.docx')) return 'docx';
    if (href.includes('.doc')) return 'doc';
    if (href.includes('.xlsx')) return 'xlsx';
    if (href.includes('.xls')) return 'xls';
    if (href.includes('.csv')) return 'csv';
    if (href.includes('.zip')) return 'zip';
    return 'unknown';
}

export function cleanDocumentLinks(rawLinks = []) {
    return uniqueBy(
        rawLinks
            .map((link) => ({ text: cleanText(link.text) || 'Tender document', href: cleanText(link.href) }))
            .filter(isTenderDocumentLink)
            .map((link) => ({ ...link, type: getDocumentType(link) })),
        (link) => link.href,
    );
}

async function parsePdfBuffer(buffer) {
    const parser = new PDFParse({ data: buffer });
    try {
        const result = await parser.getText();
        return result.text || '';
    } finally {
        await parser.destroy();
    }
}

export async function fetchPublicPdfText(url, options = {}) {
    const { maxBytes = 10 * 1024 * 1024, timeoutMs = 30_000, fetchImpl = fetch, parsePdf = parsePdfBuffer } = options;

    if (!isTrustedPublicUrl(url)) return { ok: false, reason: 'Untrusted or non-HTTPS URL', text: '' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetchImpl(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'PRAZ-Tender-Scraper/0.4',
                Accept: 'application/pdf',
            },
        });
        if (!response.ok) return { ok: false, reason: `HTTP ${response.status}`, text: '' };

        const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
        const declaredSize = Number(response.headers?.get?.('content-length') || 0);
        if (declaredSize > maxBytes) return { ok: false, reason: `Document exceeds ${maxBytes} bytes`, text: '' };

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > maxBytes) return { ok: false, reason: `Document exceeds ${maxBytes} bytes`, text: '' };
        if (!contentType.includes('pdf') && buffer.subarray(0, 5).toString() !== '%PDF-') {
            return { ok: false, reason: 'Response is not a PDF', text: '' };
        }

        const text = cleanText(await parsePdf(buffer));
        return { ok: true, reason: 'Parsed', text };
    } catch (error) {
        return {
            ok: false,
            reason: error?.name === 'AbortError' ? 'Request timed out' : error?.message || 'PDF extraction failed',
            text: '',
        };
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
}

export async function analyzePublicDocuments(documentLinks, options = {}) {
    const {
        analyzeDocuments = false,
        maxDocumentsPerTender = 2,
        maxDocumentSizeMB = 10,
        documentTextMaxChars = 12_000,
        fetchPdf = fetchPublicPdfText,
    } = options;

    const pdfDocuments = (documentLinks || []).filter(
        (link) => link.type === 'pdf' || /\.pdf(?:[?#]|$)/i.test(link.href),
    );
    const base = {
        documentCount: documentLinks?.length || 0,
        hasPublicDocuments: Boolean(documentLinks?.length),
        documentsAnalyzed: 0,
        documentAnalysisErrors: [],
        documentTextExtracted: false,
        documentText: '',
    };

    if (!analyzeDocuments) return { ...base, documentAnalysisStatus: 'DISABLED' };
    if (!pdfDocuments.length || maxDocumentsPerTender === 0) return { ...base, documentAnalysisStatus: 'NO_DOCUMENTS' };

    const textParts = [];
    const selected = pdfDocuments.slice(0, maxDocumentsPerTender);
    for (const document of selected) {
        const result = await fetchPdf(document.href, {
            maxBytes: maxDocumentSizeMB * 1024 * 1024,
        });
        base.documentsAnalyzed += 1;
        if (result.ok && result.text) {
            textParts.push({ text: `Document: ${document.text}\n${result.text}`, sourceUrl: document.href });
        } else {
            base.documentAnalysisErrors.push({ url: document.href, error: result.reason });
        }
    }

    base.documentText = textParts
        .map((part) => part.text)
        .join('\n\n')
        .slice(0, documentTextMaxChars);
    base.documentTextExtracted = Boolean(base.documentText);
    if (base.documentText) {
        base.documentAnalysisStatus = base.documentAnalysisErrors.length ? 'PARTIAL' : 'COMPLETED';
    } else if (base.documentAnalysisErrors.length) {
        base.documentAnalysisStatus = 'FAILED';
    } else {
        base.documentAnalysisStatus = 'NO_DOCUMENTS';
    }
    return { ...base, documents: textParts };
}
