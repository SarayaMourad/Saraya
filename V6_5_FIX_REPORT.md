# Saraya V6.5 — focused source fixes (NOT production validated)

Changes in backend/src/lib/analyticsTools.ts:
- General business question now aggregates confirmed-shift sales, corrections/consumption, historical period comparison and leading revenue products.
- Historical comparison reports absolute and percentage differences, with warnings when shift counts differ.
- Chicha tobacco consumption denominator includes normal and personnel chichas, assuming both use the tracked tobacco; this mapping still requires confirmation from the owner.
- Historical chicha ratios use the same denominator.
- RECETTE stock movement queries are scoped through recorded shifts belonging to the configured shop; no uncommitted movements are included.
- Stock master table Item has no shopId: explicitly warns that stock is not tenant-isolated. The project is single-café only.
- Price simulation no longer reports an invented profit difference without validated costs.

## Validation
- Source patches applied and packaged: PASS.
- TypeScript compile: BLOCKED; npm dependency installation timed out and TypeScript reports missing @types dependencies. No successful build is claimed.
- PostgreSQL integration: NOT TESTED; no disposable database configured.
- Live GPT responses: NOT TESTED.
- /recette regression: NOT TESTED.
- Production-ready: NO. Do not replace your working deployment without completing these tests.

## Remaining limitations
- No complete metrics catalog or six-capability engine yet.
- No product-cost based profitability.
- No complete scenario engine for staffing/purchasing.
- Stock Item lacks shopId; keep dedicated single-café database.
- Historical windows are rolling-day windows, not complete local calendar weeks/months.
- Money aggregation uses JavaScript numbers in analytics and should be migrated to precise decimal arithmetic for production financial reporting.
