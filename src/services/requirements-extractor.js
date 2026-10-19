import { cleanText, uniqueBy, uniqueLimited } from '../utils/text.js';

const RULES = {
    mandatory: [
        [/company registration|certificate of incorporation|incorporation certificate/i, 'Company registration'],
        [/tax clearance|tax certificate|valid tax clearance certificate/i, 'Tax clearance'],
        [/supplier registration|praz registration|registered supplier|vendor registration/i, 'Supplier registration'],
        [/business licen[cs]e|operating licen[cs]e/i, 'Business licence'],
        [/mandatory declaration|declaration form|signed declaration/i, 'Mandatory declaration form'],
    ],
    eligibility: [
        [
            /eligib(?:le|ility)|supplier categor(?:y|ies)|registration categor/i,
            'Supplier category or eligibility classification',
        ],
        [/previous experience|relevant experience|years? of experience/i, 'Relevant experience'],
        [
            /professional qualification|professional registration|registered engineer|registered architect/i,
            'Professional qualification or registration',
        ],
        [/industry certification|iso\s*9001|certified supplier/i, 'Industry certification'],
    ],
    submission: [
        [/bid submission|submit (?:the )?(?:bid|tender)|submission deadline/i, 'Tender submission'],
        [/electronic submission|submit online|e-?gp|online portal/i, 'Electronic submission'],
        [/supporting document|supporting documentation|attach(?:ed)? documents?/i, 'Supporting documentation'],
        [/tender form|bid form|prescribed form/i, 'Required tender or bid form'],
        [/closing date|closing time|deadline/i, 'Submission deadline'],
    ],
    financial: [
        [/bid security|bid bond|bid guarantee/i, 'Bid security'],
        [/bank guarantee|banking guarantee/i, 'Bank guarantee'],
        [/turnover|annual revenue|financial capacity/i, 'Turnover or financial capacity'],
        [/financial statement|audited accounts|audited financial/i, 'Financial statements'],
        [/tender fee|bid form fee|payment receipt/i, 'Tender or bid fee'],
    ],
    technical: [
        [/technical specification|technical proposal|technical requirement/i, 'Technical specifications'],
        [/equipment requirement|equipment list|plant and equipment/i, 'Equipment requirements'],
        [/previous project|similar project|track record/i, 'Previous project experience'],
        [/sample(?:s)? required|submit sample/i, 'Samples'],
        [/warranty|maintenance support/i, 'Warranty or maintenance support'],
    ],
};

function splitEvidence(text) {
    return String(text || '')
        .split(/\r?\n|(?<=[.!?])\s+/)
        .map(cleanText)
        .filter((line) => line.length >= 8 && line.length <= 500);
}

function makeRequirement(category, label, evidence, sourceType, sourceUrl) {
    const explicit = /\b(must|shall|required|mandatory|compulsory|provide|submit|attach|valid)\b/i.test(evidence);
    return {
        requirement: label,
        category,
        sourceType,
        ...(sourceUrl ? { sourceUrl } : {}),
        evidence,
        confidence: explicit ? 'high' : 'medium',
    };
}

function extractCategory(text, category, sourceType, sourceUrl) {
    const lines = splitEvidence(text);
    const requirements = [];

    for (const line of lines) {
        for (const [pattern, label] of RULES[category]) {
            if (pattern.test(line)) {
                requirements.push(makeRequirement(category, label, line, sourceType, sourceUrl));
                break;
            }
        }
    }

    return uniqueBy(requirements, (item) => `${item.category}:${item.requirement}:${item.evidence.toLowerCase()}`);
}

export function extractRequirementSignals({ detailText = '', documents = [], sourceUrl = null } = {}) {
    const sources = [
        { text: detailText, sourceType: 'HTML', sourceUrl },
        ...(documents || []).map((document) => ({
            text: document.text,
            sourceType: 'PDF',
            sourceUrl: document.sourceUrl,
        })),
    ].filter((source) => cleanText(source.text));

    const evidenceCategories = Object.fromEntries(
        Object.keys(RULES).map((category) => [
            `${category}RequirementEvidence`,
            uniqueBy(
                sources.flatMap((source) =>
                    extractCategory(source.text, category, source.sourceType, source.sourceUrl),
                ),
                (item) => `${item.requirement}:${item.evidence.toLowerCase()}`,
            ).slice(0, 30),
        ]),
    );
    const categories = Object.fromEntries(
        Object.keys(RULES).map((category) => [
            `${category}Requirements`,
            evidenceCategories[`${category}RequirementEvidence`].map((item) => item.evidence),
        ]),
    );

    const combinedText = sources.map((source) => source.text).join('\n');
    const siteVisit = detectSiteVisit(combinedText, sourceUrl);

    return {
        ...categories,
        ...evidenceCategories,
        ...siteVisit,
        requirementCount: Object.values(categories).reduce((count, items) => count + items.length, 0),
    };
}

export function detectSiteVisit(text, sourceUrl = null) {
    const lines = splitEvidence(text);
    const siteLine = lines.find((line) =>
        /site visit|site meeting|site inspection|pre-?bid conference|clarification meeting/i.test(line),
    );
    if (!siteLine) {
        return {
            siteVisitRequired: null,
            siteVisitDate: null,
            siteVisitLocation: null,
            preBidMeetingRequired: null,
            preBidMeetingDate: null,
        };
    }

    const mandatory = /mandatory|compulsory|required|must|shall/i.test(siteLine);
    const preBid = /pre-?bid|clarification/i.test(siteLine);
    const dateMatch = siteLine.match(
        /\b(\d{1,2}[-/]\w{3,9}[-/]\d{4}|\d{4}[-/]\d{2}[-/]\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/i,
    );
    const locationMatch = siteLine.match(/(?:at|venue|location)\s*[:-]?\s*(.+)$/i);

    return {
        siteVisitRequired: mandatory,
        siteVisitDate: dateMatch?.[1] || null,
        siteVisitLocation: locationMatch?.[1]?.trim() || null,
        preBidMeetingRequired: preBid ? mandatory : null,
        preBidMeetingDate: preBid ? dateMatch?.[1] || null : null,
        ...(sourceUrl ? { siteVisitEvidence: siteLine } : {}),
    };
}

export function extractBidSecurity(tender, text) {
    const sourceText = String(text || '');
    const fieldValues = [tender.bidSecurityAmountDomestic, tender.bidSecurityAmountInternational]
        .map(cleanText)
        .filter(
            (value) =>
                value && !/^bid security amount/i.test(value) && !/^(0|n\/a|not required|not applicable)$/i.test(value),
        );
    const evidenceLine = splitEvidence(sourceText).find((line) =>
        /bid security|bid bond|bank guarantee|bid guarantee/i.test(line),
    );
    const combined = [evidenceLine, ...fieldValues].filter(Boolean).join(' | ');
    const explicitlyNotRequired = /bid security.{0,80}(not required|not applicable|none|n\/a)/i.test(sourceText);
    const required = explicitlyNotRequired
        ? false
        : Boolean(evidenceLine || fieldValues.some((value) => /\d/.test(value)));

    let amount = null;
    let currency = null;
    const amountMatch = combined.match(
        /(?:USD|US\s*\$|ZWL|ZW\s*\$|BWP|EUR|GBP|\$)?\s*[\d,.]+(?:\s*(?:million|thousand))?/i,
    );
    if (amountMatch) amount = amountMatch[0].trim();
    const currencyMatch = combined.match(/\b(USD|ZWL|BWP|EUR|GBP)\b|US\s*\$|ZW\s*\$/i);
    if (currencyMatch) currency = currencyMatch[0].replace(/\s+/g, ' ').toUpperCase();

    let type = null;
    if (/bank guarantee|banking guarantee/i.test(combined)) type = 'Bank guarantee';
    else if (/bid bond/i.test(combined)) type = 'Bid bond';
    else if (required) type = 'Bid security';

    return {
        bidSecurityRequired: required || null,
        bidSecurityAmount: amount,
        bidSecurityCurrency: currency,
        bidSecurityType: type,
        bidSecurityEvidence: evidenceLine || (fieldValues.length ? fieldValues.join(' | ') : null),
    };
}

export function buildKeyRequirementsSummary(tender) {
    const requirements = [
        ...(tender.mandatoryRequirements || []),
        ...(tender.eligibilityRequirements || []),
        ...(tender.submissionRequirements || []),
        ...(tender.financialRequirements || []),
        ...(tender.technicalRequirements || []),
    ];
    if (!requirements.length) return null;
    return uniqueLimited(
        requirements.map((item) => (typeof item === 'string' ? item : item.requirement)),
        8,
    ).join('; ');
}
