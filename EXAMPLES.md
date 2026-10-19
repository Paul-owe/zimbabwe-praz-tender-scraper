# Example configurations

## Basic extraction

```json
{
    "maxItems": 10,
    "maxPages": 1,
    "includeDetails": true,
    "newOnly": false,
    "extractRequirements": true,
    "analyzeDocuments": false
}
```

## Pagination

```json
{
    "maxItems": 40,
    "maxPages": 3,
    "includeDetails": true,
    "newOnly": false,
    "analyzeDocuments": false
}
```

## New tender monitoring

```json
{
    "maxItems": 10,
    "maxPages": 1,
    "includeDetails": true,
    "newOnly": true,
    "detectChanges": true,
    "includeStatusChanges": true,
    "stateStoreId": "YOUR_ISOLATED_APIFY_KEY_VALUE_STORE_ID",
    "analyzeDocuments": false
}
```

## Requirement extraction

```json
{
    "maxItems": 5,
    "maxPages": 1,
    "includeDetails": true,
    "extractRequirements": true,
    "analyzeDocuments": false
}
```

## Optional PDF analysis

```json
{
    "maxItems": 3,
    "maxPages": 1,
    "includeDetails": true,
    "extractRequirements": true,
    "analyzeDocuments": true,
    "maxDocumentsPerTender": 1,
    "maxDocumentSizeMB": 10
}
```
