import { cleanText, normalizeEmptyValue } from '../utils/text.js';

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getFieldFromLines(lines, label) {
    const normalizedLabel = cleanText(label).toLowerCase();
    const labelRegex = new RegExp(`^${escapeRegex(label)}\\s*:?\\s*`, 'i');
    for (let index = 0; index < lines.length; index += 1) {
        const line = cleanText(lines[index]);
        if (!line.toLowerCase().startsWith(normalizedLabel)) continue;
        const sameLineValue = cleanText(line.replace(labelRegex, ''));
        if (sameLineValue && sameLineValue.toLowerCase() !== normalizedLabel && sameLineValue !== ':')
            return sameLineValue;
        for (let next = index + 1; next < Math.min(index + 6, lines.length); next += 1) {
            const candidate = cleanText(lines[next]);
            if (!candidate || candidate.endsWith(':') || candidate.toLowerCase() === normalizedLabel) continue;
            return candidate;
        }
    }
    return null;
}

export function parseDetailTender({ lines, listData = {}, sourceUrl, scrapedAt = new Date().toISOString() }) {
    const field = (label, fallbackLabel) =>
        normalizeEmptyValue(
            getFieldFromLines(lines, label) || (fallbackLabel && getFieldFromLines(lines, fallbackLabel)),
            label,
        );
    return {
        country: 'Zimbabwe',
        source: 'PRAZ eGP',
        tenderId: listData.tenderId || getFieldFromLines(lines, 'Tender Id'),
        tenderReferenceNumber: listData.tenderReferenceNumber || getFieldFromLines(lines, 'Tender Reference Number'),
        title: listData.title || getFieldFromLines(lines, 'Project Name') || getFieldFromLines(lines, 'Tender Title'),
        categoryCode: listData.categoryCode || null,
        category: listData.category || getFieldFromLines(lines, 'Required Supplier Categories'),
        buyer: listData.buyer || getFieldFromLines(lines, 'Procuring Entity'),
        status: listData.status || getFieldFromLines(lines, 'Status'),
        publishDate:
            listData.publishDate ||
            getFieldFromLines(lines, 'Published Date') ||
            getFieldFromLines(lines, 'Date created'),
        closingDate:
            listData.closingDate ||
            getFieldFromLines(lines, 'Closing Date') ||
            getFieldFromLines(lines, 'Bid Submission Closing Date'),
        procurementMethod: field('Procurement Method'),
        classOfProcurement: field('Class of Procurement'),
        deliveryLocation: field('Delivery/Project Location'),
        bidFormFee: field('Bid Form Fee'),
        bidSecurityAmountDomestic: field('Bid Security Amount(Domestic)'),
        bidSecurityAmountInternational: field('Bid Security Amount(International)'),
        sourceUrl,
        scrapedAt,
    };
}
