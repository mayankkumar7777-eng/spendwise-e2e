# SpendWise — Software Requirements Specification (SRS)

## 1. Document control

| Field | Value |
| --- | --- |
| Version | v1.1 |
| Date | 2026-11-23T06:33:10.025Z |
| Status | Approved |
| Approver | mayankkumar7777-eng |

Change log

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| v1.0 | 2026-11-23 | BA agent | Initial draft |
| v1.1 | 2026-11-23 | BA agent | Added FR-13 (manager views receipt of queued claim) with ACs, UI and traceability rows; marked FR-10 CSV injection (AC-10.2) as security test as well; SFS comment needs no change here |

## 2. Introduction

### Purpose

Define testable requirements for SpendWise.

### Scope

Login, submit/edit/delete claims with receipts, manager approval, auto-approval of small claims, duplicate warning, claim history, finance monthly report and CSV export, demo data.

### Definitions

Employees, managers and finance staff in a company of 50-200 people. Admins optional.

### References (BRD)

BRD vv1.0.

## 3. Overall description

### Product perspective

Claims are handled via email and spreadsheets: approvals take about a week, receipts get lost, and finance re-types everything for payroll.

### User classes

Employee: Submits and manages their own claims.

Manager: Everything an Employee can do for own claims, plus approval of direct reports' claims.

Finance: Read-only access to all claims, reports and exports.

### Operating environment

Google Cloud Run: services spendwise-staging and spendwise. If cloud setup is not ready, deploy with local-docker first.; region asia-south1 (Mumbai).

### Design constraints

The requester is the only reviewer and approver.; deadline Demo-ready in 2 weeks.; budget Hosting under USD 20 per month..

### Assumptions

- v1 is demo/UAT only: no backups, data resets on redeploy.
- FR-01 account lock (5 consecutive failures) and NFR-03 per-IP limit (10 failed per minute) are complementary.
- Demo data and the known test password are acceptable in production (no real data).
- ASSUMPTION: an employee may replace the receipt while the claim is Submitted, as part of editing (FR-06).
- Meals claims never require a receipt (cap 2000.00 equals the receipt threshold); receipt is optional for Meals.
- The duplicate check (FR-04) applies to auto-approved claims too; only Rejected claims are excluded.

## 4. Functional requirements

### FR-01 — Login and logout

- Description: Login and logout with email and password. Sessions expire after 30 minutes of inactivity. Account locked for 15 minutes after 5 consecutive failed attempts.
- Priority (MoSCoW): Must
- User story: Login and logout with email and password. Sessions expire after 30 minutes of inactivity. Account locked for 15 minutes after 5 consecutive failed attempts.
- Acceptance criteria:
  - AC-01.1 Given A registered user When They log in with valid credentials Then 200 with user and HttpOnly session cookie
  - AC-01.2 Given A registered user When They submit wrong credentials Then 401 INVALID_CREDENTIALS
  - AC-01.3 Given 5 consecutive failed logins When A further login is attempted within 15 minutes Then 423 ACCOUNT_LOCKED
  - AC-01.4 Given A logged-in session idle for 30 minutes When Any request is made Then 401 UNAUTHENTICATED
- Related BR: BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-08, BR-09, BR-10, BR-11, BR-12, BR-13, BR-14

### FR-02 — Submit a claim

- Description: Submit a claim with date, category, amount in INR (max 2 decimals), description (3-200 chars), optional receipt (JPG, PNG or PDF, max 2 MB). Categories: Travel, Meals, Lodging, Office Supplies, Internet & Phone, Training.
- Priority (MoSCoW): Must
- User story: Submit a claim with date, category, amount in INR (max 2 decimals), description (3-200 chars), optional receipt (JPG, PNG or PDF, max 2 MB). Categories: Travel, Meals, Lodging, Office Supplies, Internet & Phone, Training.
- Acceptance criteria:
  - AC-02.1 Given A logged-in employee When They submit valid claim data Then 201 with the created claim
  - AC-02.2 Given Invalid fields When They submit Then 422 VALIDATION_FAILED with per-field codes
  - AC-02.3 Given A receipt over 2 MB or not JPG/PNG/PDF When They submit Then FILE_TOO_LARGE or FILE_TYPE_NOT_ALLOWED
- Related BR: BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-08, BR-09, BR-10, BR-11, BR-12, BR-13, BR-14

### FR-03 — Auto-approval of small claims

- Description: Claims of 500.00 or less are auto-approved at submission, decided by 'system'.
- Priority (MoSCoW): Must
- User story: Claims of 500.00 or less are auto-approved at submission, decided by 'system'.
- Acceptance criteria:
  - AC-03.1 Given A valid claim of 500.00 When Submitted Then Status Approved, decided by system
  - AC-03.2 Given A valid claim of 500.01 When Submitted Then Status Submitted, awaits manager
- Related BR: BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-08, BR-09, BR-10, BR-11, BR-12, BR-13, BR-14

### FR-04 — Duplicate warning

- Description: If the same employee has a non-rejected claim with the same date, category and amount, submission is blocked with a warning; allowed if the user confirms.
- Priority (MoSCoW): Must
- User story: If the same employee has a non-rejected claim with the same date, category and amount, submission is blocked with a warning; allowed if the user confirms.
- Acceptance criteria:
  - AC-04.1 Given A matching non-rejected claim exists When Submitted without confirmDuplicate Then 409 DUPLICATE_CLAIM
  - AC-04.2 Given A matching non-rejected claim exists When Submitted with confirmDuplicate=true Then 201 claim created
  - AC-04.3 Given The only match is Rejected When Submitted Then No duplicate warning
- Related BR: BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-08, BR-09, BR-10, BR-11, BR-12, BR-13, BR-14

### FR-05 — My claims list

- Description: List own claims filterable by status, month and category; newest first; 20 per page; shows total amount of the filtered list.
- Priority (MoSCoW): Must
- User story: List own claims filterable by status, month and category; newest first; 20 per page; shows total amount of the filtered list.
- Acceptance criteria:
  - AC-05.1 Given An employee with many claims When They open My claims Then Newest first, 20 per page, with sumAmount of the filtered list
  - AC-05.2 Given Filters applied When The list loads Then Only matching own claims and matching total
- Related BR: BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-08, BR-09, BR-10, BR-11, BR-12, BR-13, BR-14

### FR-06 — Edit or delete own claim

- Description: Employees can edit or delete their own claim only while it is Submitted.
- Priority (MoSCoW): Must
- User story: Employees can edit or delete their own claim only while it is Submitted.
- Acceptance criteria:
  - AC-06.1 Given An own Submitted claim When Edited or deleted Then 200 or 204
  - AC-06.2 Given An Approved or Rejected claim When Edit or delete attempted Then 409 CLAIM_LOCKED
- Related BR: BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-08, BR-09, BR-10, BR-11, BR-12, BR-13, BR-14

### FR-07 — Manager approval queue

- Description: Manager sees pending claims of direct reports; approves, or rejects with a comment of at least 5 characters.
- Priority (MoSCoW): Must
- User story: Manager sees pending claims of direct reports; approves, or rejects with a comment of at least 5 characters.
- Acceptance criteria:
  - AC-07.1 Given A manager When They open the queue Then Only Submitted claims of direct reports
  - AC-07.2 Given A direct report's Submitted claim When Manager approves Then 200, status Approved
  - AC-07.3 Given A reject comment under 5 characters When Manager rejects Then 422 COMMENT_REQUIRED
  - AC-07.4 Given A manager's own claim When They approve it Then 403 SELF_APPROVAL_NOT_ALLOWED
  - AC-07.5 Given A claim of a non-report When Approve attempted Then 403 FORBIDDEN
- Related BR: BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-08, BR-09, BR-10, BR-11, BR-12, BR-13, BR-14

### FR-08 — Claim history

- Description: Every claim shows history: created, edited, approved/rejected, by whom and when.
- Priority (MoSCoW): Must
- User story: Every claim shows history: created, edited, approved/rejected, by whom and when.
- Acceptance criteria:
  - AC-08.1 Given A claim with events When Viewed by an authorised user Then History lists each event with actor and timestamp
  - AC-08.2 Given An unauthorised user When They request the claim Then 403 or 404
- Related BR: BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-08, BR-09, BR-10, BR-11, BR-12, BR-13, BR-14

### FR-09 — Finance monthly report

- Description: For a chosen month: approved totals by category and by employee, grand total, approved claim count, and claim counts by status.
- Priority (MoSCoW): Must
- User story: For a chosen month: approved totals by category and by employee, grand total, approved claim count, and claim counts by status.
- Acceptance criteria:
  - AC-09.1 Given A Finance user and a month When They request the report Then byCategory, byEmployee, statusCounts, grandTotal, approvedCount returned
  - AC-09.2 Given A non-Finance user When They request the report Then 403 FORBIDDEN
- Related BR: BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-08, BR-09, BR-10, BR-11, BR-12, BR-13, BR-14

### FR-10 — Finance CSV export

- Description: CSV export of a month's approved claims, UTF-8, columns claim_id, employee_email, employee_name, date, category, amount, description, approved_by, approved_at. Cells starting with = + - @ are prefixed with '.
- Priority (MoSCoW): Must
- User story: CSV export of a month's approved claims, UTF-8, columns claim_id, employee_email, employee_name, date, category, amount, description, approved_by, approved_at. Cells starting with = + - @ are prefixed with '.
- Acceptance criteria:
  - AC-10.1 Given Approved claims in a month When Finance exports Then text/csv UTF-8 with the specified columns
  - AC-10.2 Given A description starting with =, +, - or @ When Exported Then Cell prefixed with '
- Related BR: BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-08, BR-09, BR-10, BR-11, BR-12, BR-13, BR-14

### FR-11 — Demo data seeding

- Description: When SEED_DEMO_DATA=true, load seed/users.csv, seed/categories.csv and seed/claims.csv at start-up keeping CLM-nnnn IDs. Idempotent. New claims continue the sequence.
- Priority (MoSCoW): Must
- User story: When SEED_DEMO_DATA=true, load seed/users.csv, seed/categories.csv and seed/claims.csv at start-up keeping CLM-nnnn IDs. Idempotent. New claims continue the sequence.
- Acceptance criteria:
  - AC-11.1 Given SEED_DEMO_DATA=true When App starts Then Seed data loaded with given claim IDs
  - AC-11.2 Given Seed already loaded When App restarts Then No duplicates
  - AC-11.3 Given Seeded claims exist When A new claim is created Then ID continues the CLM-nnnn sequence
- Related BR: BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-08, BR-09, BR-10, BR-11, BR-12, BR-13, BR-14

### FR-12 — Health endpoint

- Description: GET /api/health returns status ok and semver version.
- Priority (MoSCoW): Must
- User story: GET /api/health returns status ok and semver version.
- Acceptance criteria:
  - AC-12.1 Given The app is running When GET /api/health Then 200 {"status":"ok","version":"<semver>"}
- Related BR: BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-08, BR-09, BR-10, BR-11, BR-12, BR-13, BR-14

### FR-13 — View receipt of a queued claim

- Description: A manager can view the receipt of a claim in their approval queue before deciding to approve or reject it.
- Priority (MoSCoW): Must
- User story: As a manager, I can view the receipt of a claim in my queue before deciding.
- Acceptance criteria:
  - AC-13.1 Given A Submitted claim with a receipt in the manager's queue When The manager requests its receipt Then 200 with the receipt file
  - AC-13.2 Given A claim of a non-report When A manager requests its receipt Then 403 FORBIDDEN
- Related BR: BR-01, BR-02, BR-03, BR-04, BR-05, BR-06, BR-07, BR-08, BR-09, BR-10, BR-11, BR-12, BR-13, BR-14

## 5. Non-functional requirements

| ID | Category | Measurable target | Verification method |
| --- | --- | --- | --- |
| NFR-01 | Performance (latency, throughput, concurrent users) | NFR-01: p95 under 500 ms for list claims, submit claim and monthly report with 50 concurrent users; error rate under 1%. | Automated or manual verification |
| NFR-02 | Scalability | Company of 50-200 users; 50 concurrent users (NFR-01). | Automated or manual verification |
| NFR-03 | Availability | NFR-02: 99.5% per month in production (best effort on demo hosting); staging N/A. | Automated or manual verification |
| NFR-04 | Security (authN/authZ, OWASP Top 10, data protection) | NFR-03: OWASP Top 10; passwords hashed with argon2id or bcrypt (cost >= 12); server-side role checks on every endpoint; session cookie HttpOnly, SameSite=Lax, Secure over HTTPS; reject state-changing requests whose Origin header is not the app's own origin; security headers (CSP, nosniff, frame-ancestors 'none'), no X-Powered-By; max 10 failed login attempts per minute per IP; request body limit 5 MB; no stack traces in responses; receipts stored with server-generated names. | Automated or manual verification |
| NFR-05 | Privacy and compliance | NFR-04: store only name, email, role and manager; no passwords, tokens or receipt contents in logs; receipts visible only to the owner, their manager and finance. | Automated or manual verification |
| NFR-06 | Accessibility (WCAG level) | NFR-05: WCAG 2.1 AA for login, submit claim, my claims, manager queue, reports; fully keyboard operable. | Automated or manual verification |
| NFR-07 | Usability and responsive breakpoints | NFR-06: usable at 375 px, 768 px and 1280 px widths. | Automated or manual verification |
| NFR-08 | Localisation, currency and time zone | NFR-07: English UI; INR with Indian digit grouping (₹1,23,456.00); dates shown as DD-MMM-YYYY, ISO 8601 in the API; time zone Asia/Kolkata; Unicode text (Hindi, emoji, accents) everywhere. | Automated or manual verification |
| NFR-09 | Observability | NFR-08: JSON logs with request id; health endpoint; errors logged once. | Automated or manual verification |
| NFR-10 | Data retention and backup | NFR-09: SQLite acceptable for the demo; data resets on redeploy (accepted for UAT); code must allow switching to PostgreSQL later. | Automated or manual verification |
| NFR-11 | Browser support | NFR-10: latest Chrome, Edge, Firefox and Safari. | Automated or manual verification |

## 6. External interfaces

### UI

- Login and logout
- Submit a claim
- Auto-approval of small claims
- Duplicate warning
- My claims list
- Edit or delete own claim
- Manager approval queue
- Claim history
- Finance monthly report
- Finance CSV export
- Demo data seeding
- Health endpoint
- View receipt of a queued claim

### API

```text
POST /api/auth/login (200; 401 INVALID_CREDENTIALS; 423 ACCOUNT_LOCKED); POST /api/auth/logout (204); GET /api/me; GET /api/claims?status=&month=YYYY-MM&category=&page= -> {items,total,page,pageSize,sumAmount}; POST /api/claims (JSON or multipart with receipt; 201; 422 VALIDATION_FAILED; 409 DUPLICATE_CLAIM); GET /api/claims/{id} (claim + history; 403/404); PATCH /api/claims/{id} (200; 409 CLAIM_LOCKED); DELETE /api/claims/{id} (204; 409 CLAIM_LOCKED); GET /api/claims/{id}/receipt (owner, their manager, finance only; 403 FORBIDDEN); GET /api/team/claims?status=Submitted; POST /api/claims/{id}/approve (200; 403 FORBIDDEN; 403 SELF_APPROVAL_NOT_ALLOWED; 409 CLAIM_LOCKED); POST /api/claims/{id}/reject {comment} (200; 422 COMMENT_REQUIRED); GET /api/reports/monthly?month=YYYY-MM -> {month,byCategory[],byEmployee[],statusCounts,grandTotal,approvedCount}; GET /api/reports/monthly.csv?month=YYYY-MM (text/csv); GET /api/health. Money in JSON is a string with 2 decimals, e.g. "1234.50".
```

### Integrations

None in v1. No payroll, HR or SSO integration; finance uses the CSV export (FR-10).

## 7. Data requirements

Entities: Users (email, name, role, manager), Categories, Claims (CLM-nnnn id, date, category, amount, description, receipt, status Submitted/Approved/Rejected, decided by), Claim history events.

Retention and privacy: NFR-09: SQLite acceptable for the demo; data resets on redeploy (accepted for UAT); code must allow switching to PostgreSQL later.; NFR-04: store only name, email, role and manager; no passwords, tokens or receipt contents in logs; receipts visible only to the owner, their manager and finance..

## 8. Deployment and environment requirements

CI/CD: GitHub Actions. Branch strategy: main is protected; work on short-lived feature/fix branches merged via pull requests. Semantic versions, git tags v*, release notes from commits.. Environments: staging, production. Target: Google Cloud Run: services spendwise-staging and spendwise. If cloud setup is not ready, deploy with local-docker first., region asia-south1 (Mumbai). Production approval: GitHub user mayankkumar7777-eng.

## 9. Traceability matrix

| Requirement | Acceptance criteria | Test type (unit / functional / load / security / manual) | Test ID |
| --- | --- | --- | --- |
| FR-01 | AC-01.1 | functional | TEST-AC-01-1 |
| FR-01 | AC-01.2 | functional | TEST-AC-01-2 |
| FR-01 | AC-01.3 | functional | TEST-AC-01-3 |
| FR-01 | AC-01.4 | functional | TEST-AC-01-4 |
| FR-02 | AC-02.1 | functional | TEST-AC-02-1 |
| FR-02 | AC-02.2 | functional | TEST-AC-02-2 |
| FR-02 | AC-02.3 | functional | TEST-AC-02-3 |
| FR-03 | AC-03.1 | functional | TEST-AC-03-1 |
| FR-03 | AC-03.2 | functional | TEST-AC-03-2 |
| FR-04 | AC-04.1 | functional | TEST-AC-04-1 |
| FR-04 | AC-04.2 | functional | TEST-AC-04-2 |
| FR-04 | AC-04.3 | functional | TEST-AC-04-3 |
| FR-05 | AC-05.1 | functional | TEST-AC-05-1 |
| FR-05 | AC-05.2 | functional | TEST-AC-05-2 |
| FR-06 | AC-06.1 | functional | TEST-AC-06-1 |
| FR-06 | AC-06.2 | functional | TEST-AC-06-2 |
| FR-07 | AC-07.1 | functional | TEST-AC-07-1 |
| FR-07 | AC-07.2 | functional | TEST-AC-07-2 |
| FR-07 | AC-07.3 | functional | TEST-AC-07-3 |
| FR-07 | AC-07.4 | functional | TEST-AC-07-4 |
| FR-07 | AC-07.5 | functional | TEST-AC-07-5 |
| FR-08 | AC-08.1 | functional | TEST-AC-08-1 |
| FR-08 | AC-08.2 | functional | TEST-AC-08-2 |
| FR-09 | AC-09.1 | functional | TEST-AC-09-1 |
| FR-09 | AC-09.2 | functional | TEST-AC-09-2 |
| FR-10 | AC-10.1 | functional | TEST-AC-10-1 |
| FR-10 | AC-10.2 | functional, security | TEST-AC-10-2 |
| FR-11 | AC-11.1 | functional | TEST-AC-11-1 |
| FR-11 | AC-11.2 | functional | TEST-AC-11-2 |
| FR-11 | AC-11.3 | functional | TEST-AC-11-3 |
| FR-12 | AC-12.1 | functional | TEST-AC-12-1 |
| FR-13 | AC-13.1 | functional | TEST-AC-13-1 |
| FR-13 | AC-13.2 | functional | TEST-AC-13-2 |
| BR-01 | N/A — business rule | manual | TEST-BR-01 |
| BR-02 | N/A — business rule | manual | TEST-BR-02 |
| BR-03 | N/A — business rule | manual | TEST-BR-03 |
| BR-04 | N/A — business rule | manual | TEST-BR-04 |
| BR-05 | N/A — business rule | manual | TEST-BR-05 |
| BR-06 | N/A — business rule | manual | TEST-BR-06 |
| BR-07 | N/A — business rule | manual | TEST-BR-07 |
| BR-08 | N/A — business rule | manual | TEST-BR-08 |
| BR-09 | N/A — business rule | manual | TEST-BR-09 |
| BR-10 | N/A — business rule | manual | TEST-BR-10 |
| BR-11 | N/A — business rule | manual | TEST-BR-11 |
| BR-12 | N/A — business rule | manual | TEST-BR-12 |
| BR-13 | N/A — business rule | manual | TEST-BR-13 |
| BR-14 | N/A — business rule | manual | TEST-BR-14 |
| NFR-01 | N/A | load | TEST-NFR-01 |
| NFR-02 | N/A | load | TEST-NFR-02 |
| NFR-03 | N/A | manual | TEST-NFR-03 |
| NFR-04 | N/A | security | TEST-NFR-04 |
| NFR-05 | N/A | security | TEST-NFR-05 |
| NFR-06 | N/A | manual | TEST-NFR-06 |
| NFR-07 | N/A | manual | TEST-NFR-07 |
| NFR-08 | N/A | manual | TEST-NFR-08 |
| NFR-09 | N/A | manual | TEST-NFR-09 |
| NFR-10 | N/A | manual | TEST-NFR-10 |
| NFR-11 | N/A | manual | TEST-NFR-11 |

## 10. Open questions and change requests

| ID | Type (question / CR) | Description | Status |
| --- | --- | --- | --- |
| OQ-01 | question | Security scanning of staging is not authorised; revisit if this changes. | Open |
