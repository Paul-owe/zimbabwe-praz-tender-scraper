import { cleanText } from '../utils/text.js';

export async function extractTenderRowsFromPage(page) {
    const rows = await page.$$eval('tr', (tableRows) =>
        tableRows.map((row) => ({
            cells: Array.from(row.querySelectorAll('th, td')).map((cell) => cell.innerText.replace(/\s+/g, ' ').trim()),
            href: row.querySelector('a[href*="viewLiveTenderDetails"]')?.href || null,
        })),
    );

    return rows.filter((row) => /^\d+$/.test(row.cells?.[0] || '') && row.cells.length >= 8);
}

export function buildListTenderFromCells(cells, href, now = new Date().toISOString()) {
    const tenderId = cleanText(cells[0]);
    return {
        country: 'Zimbabwe',
        source: 'PRAZ eGP',
        tenderId,
        tenderReferenceNumber: cleanText(cells[1]) || null,
        title: cleanText(cells[2]) || null,
        categoryCode: cleanText(cells[3]) || null,
        category: cleanText(cells[4]) || null,
        buyer: cleanText(cells[5]) || null,
        status: cleanText(cells[6]) || null,
        publishDate: cleanText(cells[7]) || null,
        closingDate: cleanText(cells[8]) || null,
        procurementMethod: null,
        classOfProcurement: null,
        deliveryLocation: null,
        bidFormFee: null,
        bidSecurityAmountDomestic: null,
        bidSecurityAmountInternational: null,
        documentLinks: [],
        sourceUrl: href || `https://egp.praz.org.zw/Indexes/viewLiveTenderDetails/${tenderId}`,
        scrapedAt: now,
    };
}

export async function getFirstTenderIdOnPage(page) {
    return page
        .$$eval('tr', (rows) => {
            for (const row of rows) {
                const firstCell = row.querySelector('th, td')?.innerText?.replace(/\s+/g, ' ').trim() || '';
                if (/^\d+$/.test(firstCell)) return firstCell;
            }
            return null;
        })
        .catch(() => null);
}

export async function goToNextResultsPage(page) {
    const firstBefore = await getFirstTenderIdOnPage(page);
    const clicked = await page.evaluate(() => {
        const isDisabled = (element) => {
            const className = String(element.className || '').toLowerCase();
            return (
                className.includes('disabled') ||
                element.getAttribute('aria-disabled') === 'true' ||
                element.disabled ||
                Boolean(element.closest('.disabled'))
            );
        };
        const selectors = [
            'a.paginate_button.next:not(.disabled)',
            'li.paginate_button.next:not(.disabled) a',
            '.dataTables_paginate .next:not(.disabled) a',
            '.dataTables_paginate .next:not(.disabled)',
            'a[aria-label="Next"]:not(.disabled)',
            'button[aria-label="Next"]:not(.disabled)',
        ];
        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && !isDisabled(element)) {
                element.scrollIntoView({ block: 'center' });
                element.click();
                return true;
            }
        }
        const next = Array.from(document.querySelectorAll('a, button')).find((element) => {
            const text = String(element.textContent || '')
                .trim()
                .toLowerCase();
            const aria = String(element.getAttribute('aria-label') || '')
                .trim()
                .toLowerCase();
            return !isDisabled(element) && (text === 'next' || text.includes('next') || aria === 'next');
        });
        if (!next) return false;
        next.scrollIntoView({ block: 'center' });
        next.click();
        return true;
    });
    if (!clicked) return false;
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);
    if (firstBefore) {
        await page
            .waitForFunction(
                (oldId) => {
                    const first = Array.from(document.querySelectorAll('tr'))
                        .map((row) => row.querySelector('th, td')?.innerText?.replace(/\s+/g, ' ').trim())
                        .find((value) => /^\d+$/.test(value || ''));
                    return Boolean(first && first !== oldId);
                },
                firstBefore,
                { timeout: 10_000 },
            )
            .catch(() => {});
    }
    const firstAfter = await getFirstTenderIdOnPage(page);
    return Boolean(firstAfter && firstAfter !== firstBefore);
}
