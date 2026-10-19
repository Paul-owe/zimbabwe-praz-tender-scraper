import { calculateDaysRemaining } from './dates.js';
import { cleanText } from './text.js';

export function isOpenOrActive(status) {
    return ['open', 'published', 'active'].includes(cleanText(status).toLowerCase());
}

function includes(value, query) {
    return !query || cleanText(value).toLowerCase().includes(query);
}

export function classifyBusinessCategory(tender) {
    const text = [tender.title, tender.category, tender.categoryCode, tender.buyer, tender.tenderReferenceNumber]
        .join(' ')
        .toLowerCase();

    const groups = [
        ['Construction', ['construction', 'civil', 'building', 'works', 'road', 'bridge']],
        ['ICT', ['ict', 'software', 'computer', 'server', 'network', 'telecommunication', 'pabx', 'system']],
        ['Medical', ['medical', 'hospital', 'clinic', 'pharmaceutical', 'medicine', 'health']],
        ['Vehicles', ['vehicle', 'motor', 'bus', 'truck', 'fleet']],
        [
            'Energy',
            ['electricity', 'power', 'energy', 'zetdc', 'transmission', 'substation', 'pipeline', 'fuel', 'petroleum'],
        ],
        ['Security', ['security', 'guard']],
        ['Cleaning', ['cleaning', 'hygiene', 'sanitation']],
        ['Office Supplies', ['office', 'stationery', 'furniture', 'printer']],
        ['Consulting', ['consultancy', 'consultant', 'advisory', 'training']],
        ['Agriculture', ['agriculture', 'seed', 'fertilizer', 'farming']],
        ['Mining', ['mining', 'mineral']],
        ['Transport', ['transport', 'logistics', 'delivery', 'freight']],
    ];

    return groups.find(([, words]) => words.some((word) => text.includes(word)))?.[0] || 'Other';
}

export function createFilters(input = {}) {
    const filters = {
        keyword: cleanText(input.keyword).toLowerCase(),
        buyerKeyword: cleanText(input.buyerKeyword).toLowerCase(),
        categoryKeyword: cleanText(input.categoryKeyword).toLowerCase(),
        statusKeyword: cleanText(input.statusKeyword).toLowerCase(),
        procurementMethodKeyword: cleanText(input.procurementMethodKeyword).toLowerCase(),
        classOfProcurementKeyword: cleanText(input.classOfProcurementKeyword).toLowerCase(),
        businessCategory: cleanText(input.businessCategory).toLowerCase(),
        onlyOpen: Boolean(input.onlyOpen),
        minimumDaysRemaining: Number(input.minimumDaysRemaining) || 0,
        maximumDaysRemaining: Number(input.maximumDaysRemaining) || 0,
    };

    if (
        filters.minimumDaysRemaining > 0 &&
        filters.maximumDaysRemaining > 0 &&
        filters.minimumDaysRemaining > filters.maximumDaysRemaining
    ) {
        throw new Error('minimumDaysRemaining cannot be greater than maximumDaysRemaining');
    }

    return filters;
}

export function matchesTenderFilters(tender, filters) {
    const allText = [
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
        ...(tender.mandatoryRequirements || []).map(requirementText),
        ...(tender.eligibilityRequirements || []).map(requirementText),
        ...(tender.submissionRequirements || []).map(requirementText),
        ...(tender.financialRequirements || []).map(requirementText),
        ...(tender.technicalRequirements || []).map(requirementText),
    ]
        .join(' ')
        .toLowerCase();

    if (!includes(allText, filters.keyword)) return false;
    if (!includes(tender.buyer, filters.buyerKeyword)) return false;
    if (!includes(`${tender.categoryCode || ''} ${tender.category || ''}`, filters.categoryKeyword)) return false;
    if (!includes(tender.status, filters.statusKeyword)) return false;
    if (!includes(tender.procurementMethod, filters.procurementMethodKeyword)) return false;
    if (!includes(tender.classOfProcurement, filters.classOfProcurementKeyword)) return false;
    if (!includes(tender.businessCategory, filters.businessCategory)) return false;
    if (filters.onlyOpen && !isOpenOrActive(tender.status)) return false;

    const days = tender.daysRemaining ?? calculateDaysRemaining(tender.closingDate);
    if (filters.minimumDaysRemaining > 0 && (days === null || days < filters.minimumDaysRemaining)) return false;
    if (filters.maximumDaysRemaining > 0 && (days === null || days > filters.maximumDaysRemaining)) return false;
    return true;
}

export function matchesListFilters(tender, filters) {
    const listTender = { ...tender, daysRemaining: calculateDaysRemaining(tender.closingDate) };
    return matchesTenderFilters(listTender, filters);
}

function requirementText(value) {
    return typeof value === 'string' ? value : value?.requirement || value?.evidence || '';
}
