# Saraya V6.5 BI expansion — validation candidate

## Added in this delivery
- `analyze_financial_health`: recorded shifts, separate ticket/cash/recette/corrections/salaries/expenses, missing cost disclosures; does not invent net profit.
- `analyze_opportunities`: top products, category revenue shares, recurring stock corrections, negative period changes, with evidence, caveats and measurable next steps.
- `analyze_business_question` now orchestrates financial, opportunity, sales, consumption and historical comparison datasets.
- Historical comparison returns ticket sales per recorded shift to help detect unequal shift coverage.
- Money aggregation in selected analytics paths uses integer millimes to reduce floating-point summation error.
- Corrected last-shift fallback to use mapped chicha denominator.
- No schema migrations and no intended `/recette` modifications.

## Verification performed
- TypeScript syntax/transpilation diagnostics: PASS for modified `analyticsTools.ts` and `chat.ts` (global TypeScript transpileModule).
- Full TypeScript typecheck: BLOCKED. npm install did not finish within the execution limit; Prisma Client not generated in this environment.
- PostgreSQL integration: NOT TESTED (no disposable DB configured).
- Live GPT-4.1 mini: NOT TESTED (no API credentials supplied).
- `/recette` end-to-end and duplicate-shift regression: NOT TESTED.
- Frontend build: NOT TESTED.

## Known limitations / remaining risks
- This is not a fully validated production release; do not replace the working deployment.
- Historical comparisons are rolling UTC windows and do not normalize opening hours, seasonality or shift length.
- No purchase-cost accounting, product gross margins or net-profit calculations; those need verified cost inputs.
- `Item` inventory is global in the existing Prisma schema; this remains suitable only for the explicitly requested single-café installation.
- Stock discrepancy frequency is measured from recorded correction rows and is not proof of waste or theft.
- Simulations support price and fixed-rate loan cases; broader staffing/purchasing scenario support remains future work.
- Analysis tool output can be large; additional pagination/limits and security hardening should be tested before production.

## Suggested validation commands
From `backend/`: `npm ci` (or `npm install` if lockfile absent), `npx prisma generate`, `npm run build`. Use a disposable PostgreSQL test database to verify analytical outputs and `/recette` regression. From `frontend/`: `npm ci` then `npm run build`.
