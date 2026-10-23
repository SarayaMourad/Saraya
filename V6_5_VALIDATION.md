# V6.5 validation candidate — not production ready

## Implemented
- Controlled `analyze_business_question` tool: recorded shifts, financial distinctions, period metadata and product sales.
- Read-only deterministic price and loan simulations with assumptions.
- Natural-language guidance in French, English and Arabic.
- No database schema changes.

## Validation
- Source inspected and patch applied: PASS.
- npm dependency installation: BLOCKED (execution timeout).
- TypeScript backend compilation: NOT VERIFIED.
- Prisma client generation: NOT VERIFIED.
- Frontend build: NOT VERIFIED.
- Disposable PostgreSQL integration tests: NOT RUN.
- Live OpenAI testing: NOT RUN.
- /recette regression, duplicate session, atomicity: NOT RUN.

## Known limitations
- This is not a complete implementation of all six capabilities requested.
- Existing analytics functions have not been fully audited for cross-shop scoping or all financial edge cases.
- No production deployment approval.
- Source ZIP supplied was V6.4.1-PREFINAL, not V6.4.2.

## Deployment precautions
Back up production PostgreSQL first. Configure DATABASE_URL, JWT secret, OpenAI API key and existing environment variables on Railway. Run `npm ci`, `npx prisma generate`, `npm run build` for backend, and `npm ci && npm run build` for frontend. Do not deploy until builds, isolated database tests and full /recette regressions pass. Keep backend secrets out of Netlify.
