import { cleanText } from './text.js';

const HARARE_OFFSET_MINUTES = 2 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = {
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

function makeHarareDate(year, month, day, hour = 0, minute = 0) {
    return new Date(Date.UTC(year, month, day, hour, minute) - HARARE_OFFSET_MINUTES * 60 * 1000);
}

export function parsePrazDate(value) {
    const text = cleanText(value);
    if (!text) return null;

    const match = text.match(/^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s](\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?$/i);

    if (match) {
        const [, dayText, monthText, yearText, hourText = '0', minuteText = '0', ampm] = match;
        const month = MONTHS[monthText.slice(0, 3).toLowerCase()];
        if (month === undefined) return null;

        let hour = Number(hourText);
        const minute = Number(minuteText);
        if (ampm?.toUpperCase() === 'PM' && hour < 12) hour += 12;
        if (ampm?.toUpperCase() === 'AM' && hour === 12) hour = 0;

        const date = makeHarareDate(Number(yearText), month, Number(dayText), hour, minute);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
    if (isoMatch) {
        const [, year, month, day, hour = '0', minute = '0'] = isoMatch;
        return makeHarareDate(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
    }

    return null;
}

export function toIsoDate(value) {
    const date = value instanceof Date ? value : parsePrazDate(value);
    return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

export function calculateDaysRemaining(value, now = new Date()) {
    const date = value instanceof Date ? value : parsePrazDate(value);
    if (!date) return null;
    return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

export function deadlineWarning(daysRemaining) {
    if (daysRemaining === null || daysRemaining === undefined) return null;
    if (daysRemaining < 0) return 'Tender closing deadline has passed';
    if (daysRemaining <= 3) return 'Tender closes within three days';
    if (daysRemaining <= 5) return 'Tender closes within five days';
    return null;
}

export const tenderTimeZone = 'Africa/Harare';
