import { isOpenOrActive } from '../utils/filters.js';

function clamp(score) {
    return Math.max(0, Math.min(100, Math.round(score)));
}

function rating(score) {
    if (score >= 80) return 'HIGH';
    if (score >= 55) return 'MEDIUM';
    return 'LOW';
}

export function calculateRisk(tender) {
    let score = 0;
    const riskFactors = [];
    const add = (factor, severity, points, description) => {
        score += points;
        riskFactors.push({ factor, severity, description });
    };

    if (tender.daysRemaining !== null && tender.daysRemaining !== undefined) {
        if (tender.daysRemaining < 0)
            add('Expired closing deadline', 'HIGH', 35, 'The tender closing deadline has passed.');
        else if (tender.daysRemaining <= 2)
            add('Very short submission window', 'HIGH', 30, 'The tender closes within two days.');
        else if (tender.daysRemaining <= 5)
            add('Short submission window', 'MEDIUM', 20, 'The tender closes within five days.');
        else if (tender.daysRemaining <= 10)
            add('Limited preparation time', 'LOW', 10, 'The tender closes within ten days.');
    } else {
        add(
            'Incomplete source information',
            'MEDIUM',
            10,
            'A closing date could not be normalized from the public source.',
        );
    }

    if (tender.siteVisitRequired === true)
        add('Mandatory site visit', 'MEDIUM', 12, 'A mandatory site visit or meeting is stated in the source.');
    if (tender.bidSecurityRequired === true)
        add('Bid security requirement', 'MEDIUM', 12, 'The source explicitly mentions bid security.');
    if ((tender.financialRequirements || []).length)
        add('Financial documentation requirements', 'MEDIUM', 8, 'Financial or security requirements were detected.');
    if ((tender.technicalRequirements || []).length >= 2)
        add('Complex technical eligibility', 'MEDIUM', 8, 'Multiple technical requirements were detected.');
    if (tender.hasPublicDocuments === false)
        add(
            'Missing publicly accessible documents',
            'LOW',
            5,
            'No tender-specific public document link was detected; this is not proof that documents are unavailable.',
        );
    if (!tender.buyer || !tender.category || !tender.closingDate)
        add('Incomplete source information', 'LOW', 5, 'One or more core public tender fields are unavailable.');

    const riskScore = clamp(score);
    return { riskScore, riskLevel: rating(riskScore), riskFactors };
}

export function calculateOpportunity(tender) {
    let score = 40;
    const opportunityFactors = [];
    const add = (factor, impact, explanation) => {
        score += impact;
        opportunityFactors.push({ factor, impact, explanation });
    };

    if (isOpenOrActive(tender.status))
        add('Active public status', 15, 'PRAZ currently labels the tender as open or active.');
    if (tender.daysRemaining !== null && tender.daysRemaining !== undefined) {
        if (tender.daysRemaining < 0)
            add(
                'Expired deadline',
                -45,
                'The normalized closing deadline has passed even if the portal status says Open.',
            );
        else if (tender.daysRemaining > 14)
            add('Sufficient preparation time', 15, 'The tender has more than 14 days remaining.');
        else if (tender.daysRemaining >= 7)
            add('Preparation time available', 10, 'The tender has at least seven days remaining.');
        else if (tender.daysRemaining <= 2)
            add('Very limited preparation time', -15, 'The tender closes within two days.');
    }
    if (tender.buyer) add('Buyer identified', 5, 'A procuring entity is present in the public record.');
    if (tender.category || tender.businessCategory)
        add('Category identified', 5, 'A procurement category is available for targeting.');
    if (tender.procurementMethod)
        add('Procurement method identified', 5, 'The procurement method is available for planning.');
    if (tender.hasPublicDocuments)
        add('Public documents available', 8, 'Tender-specific public document links were detected.');
    if ((tender.requirementCount || 0) > 0)
        add('Requirements visible', 4, 'The public source includes extractable requirement signals.');
    if ((tender.riskScore || 0) >= 70)
        add('High preparation risk', -15, 'Risk factors indicate substantial preparation pressure.');
    else if ((tender.riskScore || 0) >= 50)
        add('Moderate preparation risk', -5, 'Risk factors indicate some preparation pressure.');

    const opportunityScore = clamp(score);
    return { opportunityScore, opportunityRating: rating(opportunityScore), opportunityFactors };
}
