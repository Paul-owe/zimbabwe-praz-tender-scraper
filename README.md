# Zimbabwe PRAZ Tender Scraper & Bid Intelligence

## What does Zimbabwe PRAZ Tender Scraper do?

**Zimbabwe PRAZ Tender Scraper** collects publicly accessible procurement opportunities from the [PRAZ eGP bulletin board](https://egp.praz.org.zw/Indexes/index). It reads tender listing rows, optionally opens each detail page, normalizes Zimbabwe closing dates, extracts evidence-backed requirement signals, and produces alert-ready records for procurement teams. It does not log in, submit bids, bypass access controls, or send email automatically.

Run it manually, through the Apify API, or on a Task/Schedule. Apify provides API access, dataset downloads, scheduling, monitoring, proxy and integration options, so the results can feed a dashboard or an external workflow.

## Why use this Actor?

- Find public Zimbabwe tenders by buyer, category, status, procurement method, or keyword.
- Track new tenders and meaningful updates across repeated runs.
- Prioritize opportunities with separate, explainable opportunity and preparation-risk scores.
- Prepare suppliers with a checklist based only on requirements found in the public source.
- Connect dataset output to Google Sheets, Slack, Make, Zapier, webhooks, or a procurement system.

## How to use Zimbabwe PRAZ Tender Scraper

1. Open the Actor in Apify Console.
2. Start with `maxItems`, `maxPages`, `includeDetails: true`, and `analyzeDocuments: false`.
3. Add buyer/category/keyword filters if required.
4. Click **Start** and inspect the Dataset views: Tender Overview, Bid Details, Tender Requirements, Opportunity Intelligence, and Monitoring & Alerts.
5. For automation, create an Apify Task with the saved input and attach it to a Schedule.

## Input

The Input tab contains the complete schema. Important fields include `startUrl`, `maxItems`, `maxPages`, `includeDetails`, `keyword`, `buyerKeyword`, `categoryKeyword`, `statusKeyword`, `procurementMethodKeyword`, `classOfProcurementKeyword`, `businessCategory`, `onlyOpen`, `minimumDaysRemaining`, and `maximumDaysRemaining`.

Monitoring uses `newOnly`, `detectChanges`, `includeStatusChanges`, and an explicit `stateStoreId`. `newOnly` requires `stateStoreId`; this prevents unrelated public users from sharing one default history. `detectChanges` compares status, closing date, and a material tender fingerprint. A new tender is `NEW_TENDER`; a status change is `STATUS_CHANGED`; a closing-date change is `CLOSING_DATE_CHANGED`; another material change is `TENDER_UPDATED`; unchanged records are `NONE`.

Requirement extraction is enabled with `extractRequirements`. Public PDF analysis is opt-in with `analyzeDocuments`, `maxDocumentsPerTender`, and `maxDocumentSizeMB`. PDF analysis only follows trusted HTTPS PRAZ links and continues if one document fails.

## Output

Each dataset item retains the original source fields and adds normalized dates, requirements, bid-security fields, site-visit detection, readiness checklist, scores, and alert fields.

```json
{
    "tenderId": "39797",
    "title": "Construction of a 40km, 132kV Double Lynx line",
    "buyer": "ZIMBABWE ELECTRICITY TRANSMISSION AND DISTRIBUTION COMPANY",
    "status": "Open",
    "closingDate": "10-Jul-2026 10:00 AM",
    "closingDateIso": "2026-07-10T08:00:00.000Z",
    "isNew": true,
    "alertReason": "NEW_TENDER",
    "opportunityScore": 75,
    "riskScore": 35,
    "sourceUrl": "https://egp.praz.org.zw/Indexes/viewLiveTenderDetails/39797"
}
```

You can download the dataset in various formats such as JSON, HTML, CSV, or Excel.

## Data table

| Field                                                         | Meaning                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `tenderId`                                                    | Stable PRAZ tender identifier used for deduplication and monitoring       |
| `title`, `buyer`, `category`, `status`                        | Public tender listing information                                         |
| `publishDateIso`, `closingDateIso`, `daysRemaining`           | Normalized dates using Zimbabwe time (Africa/Harare)                      |
| `bidSecurityRequired`, `bidSecurityAmount`, `bidSecurityType` | Explicitly detected bid-security facts, or `null` when unknown            |
| `mandatoryRequirements` to `technicalRequirements`            | Backward-compatible requirement text arrays                               |
| `*RequirementEvidence`                                        | Parallel evidence objects with source type, URL, evidence, and confidence |
| `riskFactors`, `opportunityFactors`                           | Explanations behind bounded scores from 0 to 100                          |
| `readinessChecklist`                                          | Preparation items; `completed` is always false without user confirmation  |
| `alertType`, `alertMessage`, `alertPriority`                  | Fields ready for external notification workflows                          |

## How much does it cost to scrape PRAZ data?

The Actor preserves the existing Pay Per Event dataset-item pricing compatibility. Apify charges for records written to the default Dataset; filtered or deduplicated records are not written. Runtime cost depends mainly on detail-page count, browser memory, concurrency, and optional PDF analysis. Keep `analyzeDocuments` disabled for daily discovery and enable it for a smaller, targeted run. Review the Actor's current Apify Console pricing and spending limits before production scheduling.

## Persistent monitoring and scheduled runs

Create one user-owned Apify Key-Value Store per customer, business unit, or monitoring task and place its ID/name in `stateStoreId`. Do not use one shared store for unrelated customers. Then create an Apify Task with `newOnly: true`, `detectChanges: true`, and `includeStatusChanges: true`. Suggested Task names are **Daily Open Tender Monitor**, **Weekly Construction Tender Monitor**, **Daily ICT Procurement Monitor**, **ZETDC Tender Monitor**, **New Tender Alerts**, and **Tender Status Change Monitor**. Attach the Task to an Apify Schedule; no background scheduler runs inside the Actor.

Use one scheduled monitoring Task per state store and avoid overlapping runs. The Actor writes state only after a successful Dataset write and merges newer remote records when persisting, which reduces last-writer-wins loss during operational retries.

The first run emits unseen tenders. A later run suppresses unchanged tenders in `newOnly` mode and can emit meaningful updates. If no `stateStoreId` is supplied, cross-run monitoring is disabled and the Actor reports that fact in `OUTPUT`.

## Integrations

- **Google Sheets:** connect the default Dataset through Apify's Dataset export/API or an automation connector.
- **Slack:** trigger on `alertType != NONE` and post `alertTitle`, `alertMessage`, `sourceUrl`, and `closingDate`.
- **Make/Zapier:** poll the Dataset API or use a webhook after an Apify run completes, then filter on `isNew` or `hasChanges`.
- **Webhooks/REST:** use the Dataset API and the `OUTPUT` key-value record for run counters and errors.

## Document analysis and limitations

PDF analysis is deterministic text extraction, not an AI opinion or legal review. A missing public document does not prove that a tender has no requirements. The Actor does not access authentication-protected files, bypass CAPTCHA, or download arbitrary hosts. Scoring is preparation guidance, not a probability of winning or a compliance certification. Public pages can change layout, contain incomplete data, or mark an expired tender as Open; normalized dates and scoring expose that uncertainty.

## FAQ, disclaimers, and support

**Why is a field `null`?** The public source did not explicitly support that fact. Unknown is kept separate from zero or false.

**Why did a tender not appear?** Check filters, `maxItems`, `maxPages`, status, detail-only filters, and whether `newOnly` suppressed an unchanged record.

**Can the Actor submit a bid?** No. It is a public-information scraper only. Follow applicable law, PRAZ terms, robots guidance, and website usage limits.

For layout changes or feature requests, use the Actor's Issues tab. Custom extraction, integrations, and private workflows can be built as a separate solution.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the v0.2 to v0.4 history and known limitations.
