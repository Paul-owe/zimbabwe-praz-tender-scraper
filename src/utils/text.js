export function cleanText(value) {
    return String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeEmptyValue(value, label = '') {
    const cleaned = cleanText(value);
    const normalized = cleaned.toLowerCase();
    const normalizedLabel = cleanText(label).toLowerCase();

    if (!cleaned || cleaned === '-') return null;
    if (normalized === normalizedLabel || normalized === `${normalizedLabel}:`) return null;
    if (normalized.endsWith(':') && normalized.includes(normalizedLabel)) return null;

    return cleaned;
}

export function uniqueLimited(values, limit = 20) {
    const seen = new Set();
    const output = [];

    for (const value of values || []) {
        const cleaned = cleanText(value);
        const key = cleaned.toLowerCase();

        if (!cleaned || seen.has(key)) continue;
        seen.add(key);
        output.push(cleaned);
        if (output.length >= limit) break;
    }

    return output;
}

export function uniqueBy(values, keyFn) {
    const seen = new Set();
    return (values || []).filter((value) => {
        const key = keyFn(value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
