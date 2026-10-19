# v0.4 test plan

## Automated checks

- Dates: PRAZ date parsing, Zimbabwe UTC+02:00 normalization, expired and short deadlines.
- Filters: keyword, buyer, category, open-only, date range, and detail fields.
- Pagination helpers: row extraction, duplicate IDs, and list/detail field parsing.
- Monitoring: new, unchanged, status change, closing-date change, material update, corrupted state, and post-write state behavior.
- Requirements: evidence-backed mandatory, eligibility, submission, financial, and technical signals.
- Documents: valid PDF, wrong content type, oversized file, HTTP error, and partial analysis.
- Scoring and schema: bounded explainable scores, expired tenders, and valid Apify dataset structure.

Run with:

```powershell
npm test
node --check src/main.js
apify validate-schema .actor\input_schema.json
```

## Local smoke checks

Use `apify run --purge` for a clean basic run. For persistent monitoring, configure an explicit `stateStoreId` and run twice without purging that state store; local storage is not Cloud persistence. The live PRAZ website is an external dependency, so a failure there is reported as an external-source limitation rather than treated as a unit-test failure.

Recommended smoke inputs are in `EXAMPLES.md`: Basic extraction, Pagination, New tender monitoring, Requirement extraction, and Optional PDF analysis.
