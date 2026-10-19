# Zimbabwe PRAZ Tender Scraper & Bid Intelligence

Extract public tender opportunities from Zimbabwe's PRAZ eGP bulletin board.

## What this Actor does

This Actor scrapes public tender records from the Zimbabwe electronic Government Procurement system and returns clean structured data for procurement monitoring, supplier lead generation, tender alerts, and market research.

## Output includes

- Tender ID
- Tender reference number
- Tender title
- Procuring entity / buyer
- Supplier category
- Tender status
- Publish date
- Closing date
- Days remaining
- Procurement method
- Class of procurement
- Delivery/project location
- Bid form fee
- Bid security information
- Public document links where available
- Direct source URL
- Short tender summary

## Use cases

- Tender alert businesses
- Procurement consultants
- Construction suppliers
- ICT suppliers
- Medical suppliers
- Cleaning and security companies
- NGOs and donor-funded procurement teams
- Companies tracking Zimbabwe government opportunities

## Input options

- `startUrl` - PRAZ bulletin board URL
- `maxItems` - Maximum number of tenders to scrape
- `keyword` - Optional search filter, for example construction, medical, ICT, ZETDC
- `onlyOpen` - Return only open/active tenders

## Example output

```json
{
  "country": "Zimbabwe",
  "source": "PRAZ eGP",# Zimbabwe PRAZ Tender Scraper & Bid Intelligence

Extract structured public tender opportunities from Zimbabwe's PRAZ eGP bulletin board.

This Actor is built for procurement monitoring, tender lead generation, market research, supplier opportunity tracking, and public procurement intelligence.

## Version 0.4 features

### Version 0.2 foundations

- Scrape multiple bulletin board pages
- Visit tender detail pages for enriched procurement data
- Filter by keyword, buyer, category, status, procurement method, class of procurement, and business category
- Filter by minimum or maximum days remaining
- Return only open/active tenders
- Generate business categories such as Construction, ICT, Medical, Energy, Security, Cleaning, Vehicles, Consulting, and Other
- Generate opportunity score and rating
- Clean document links by removing global site documents
- Add CSV/Excel-friendly document URL and title fields

### Version 0.3 daily-monitoring features

- `newOnly` mode for returning only tenders not seen in previous runs
- Persistent tender memory using a named Apify key-value store
- Status-change alert detection
- Alert-ready fields: `isNew`, `firstSeenAt`, `lastSeenAt`, `previousStatus`, `statusChanged`, and `alertReason`
- Better support for daily/weekly scheduled monitoring tasks

### Version 0.4 intelligence features

- Requirement signal extraction from detail pages
- Optional public PDF text extraction with `analyzeDocuments`
- Eligibility, mandatory, submission, financial, and technical requirement signals
- Bid security detection
- Site visit detection
- Risk score and risk level
- Tender document summary
- Supplier readiness checklist

## Recommended input

```json
{
  "startUrl": "https://egp.praz.org.zw/Indexes/index",
  "maxItems": 50,
  "maxPages": 3,
  "includeDetails": true,
  "keyword": "",
  "buyerKeyword": "",
  "categoryKeyword": "",
  "onlyOpen": true,
  "minimumDaysRemaining": 7,
  "newOnly": false,
  "extractRequirements": true,
  "analyzeDocuments": false
}
```

## Daily alert input

```json
{
  "startUrl": "https://egp.praz.org.zw/Indexes/index",
  "maxItems": 100,
  "maxPages": 5,
  "includeDetails": true,
  "onlyOpen": true,
  "newOnly": true,
  "memoryStoreName": "praz-tender-memory",
  "extractRequirements": true,
  "analyzeDocuments": false
}
```

## PDF analysis input

Use this only when you need public PDF requirement extraction, because it can increase runtime and platform cost.

```json
{
  "startUrl": "https://egp.praz.org.zw/Indexes/index",
  "maxItems": 20,
  "maxPages": 1,
  "includeDetails": true,
  "extractRequirements": true,
  "analyzeDocuments": true,
  "maxDocumentsPerTender": 2,
  "maxPdfBytes": 2000000
}
```

## Output includes

- Tender ID
- Tender reference number
- Tender title
- Procuring entity / buyer
- Supplier category
- Business category
- Status, publish date, closing date, and days remaining
- Procurement method
- Class of procurement
- Delivery/project location
- Bid form fee
- Bid security fields
- Bid security required detection
- Public document links where available
- Document count and document summary
- Requirement signals
- Site visit detection
- Risk score and risk level
- Opportunity score and rating
- Readiness checklist
- New tender / status-change alert fields
- Direct source URL
- Short summary

## Limitations

This Actor extracts publicly available tender information only. It does not log in, bypass access controls, submit bids, or access private supplier/bidder information.

Public PDF extraction only works when a tender document link is publicly downloadable and readable as a PDF.

  "tenderId": "39797",
  "tenderReferenceNumber": "ZETDC/INTER/22/2025",
  "title": "Construction of a 40km, 132kV Double Lynx line",
  "buyer": "ZIMBABWE ELECTRICITY TRANSMISSION AND DISTRIBUTION COMPANY",
  "status": "Open",
  "closingDate": "10-Jul-2026 10:00 AM",
  "procurementMethod": "Competitive Bidding Method",
  "classOfProcurement": "Work (Non Complex Works)",
  "sourceUrl": "https://egp.praz.org.zw/Indexes/viewLiveTenderDetails/39797"
}