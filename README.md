# SpendWise

Expense-claim app: employees submit claims, managers approve, finance reports and exports CSV.
Fastify + SQLite (built-in node:sqlite) API, plain JS front end in `public/`, one Docker container.

## Requirements coverage

| Requirement | Implementation | Tests |
| --- | --- | --- |
| FR-01 login, lock, idle expiry | `src/auth.ts`, `src/app.ts` | `test/api.test.ts` (TEST-AC-01-*) |
| FR-02, BR-01..04 validation, receipts | `src/validation.ts`, `src/receipts.ts`, `src/claims.ts` | TEST-AC-02-*, units |
| FR-03, BR-05 auto-approval | `src/claims.ts`, `src/policy.ts` | TEST-AC-03-* |
| FR-04, BR-09 duplicate warning | `src/claims.ts` | TEST-AC-04-* |
| FR-05 list and filters | `src/claims.ts` | TEST-AC-05-* |
| FR-06, BR-07 edit/delete | `src/claims.ts` | TEST-AC-06-* |
| FR-07, BR-06, BR-08, BR-10 approval | `src/approvals.ts`, `src/policy.ts` | TEST-AC-07-* |
| FR-08 history | `src/claims.ts` | TEST-AC-08-* |
| FR-09, FR-10 report and CSV | `src/reports.ts`, `src/csv.ts` | TEST-AC-09-*, TEST-AC-10-* |
| FR-11, BR-11, BR-12 seeding | `src/seed.ts` | TEST-AC-11-* |
| FR-12 health | `src/app.ts` | TEST-AC-12-1 (also Playwright) |
| FR-13 manager views receipt | `src/approvals.ts` | TEST-AC-13-* |
| BR-13, BR-14 access | `src/policy.ts` | TEST-BR-* |
| NFR-01/02 load | `load-test.js` (k6, 50 VUs) | `k6 run load-test.js` |
| NFR-04/05 security, privacy | `src/app.ts`, `src/auth.ts` | TEST-NFR-04, TEST-NFR-05 |
| NFR-06/07/11 accessibility, responsive, browsers | `public/` | manual |

## Run

```sh
npm install
cp .env.example .env
npm run build
npm start
```

Set `SEED_DEMO_DATA=true` to load `seed/*.csv` (idempotent). Demo logins come from
`seed/users.csv` with password `Spend@Test2026` (test only). Data lives in `DATA_DIR` (default `data`).

## Verify

```sh
npm run lint
npm run typecheck
npm test                  # unit + API tests, coverage gate 80%
npm run test:functional   # Playwright
BASE_URL=http://127.0.0.1:3000 k6 run load-test.js
```

## Deploy locally

The container listens on port 4100 (`EXPOSE 4100`); outside Docker the default is 3000.

```sh
docker compose up --build   # http://127.0.0.1:4100/api/health
```
