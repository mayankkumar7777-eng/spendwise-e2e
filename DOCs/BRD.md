# SpendWise — Business Requirements Document (BRD)

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
| v1.1 | 2026-11-23 | BA agent | Added FR-13 (manager views receipt of a queued claim before deciding); updated scope and manager goals accordingly. |

## 2. Executive summary

90% of claims decided within 2 working days; finance stops using spreadsheets for claims within 1 month; an employee can submit a claim in under 2 minutes.

## 3. Business problem and opportunity

Claims are handled via email and spreadsheets: approvals take about a week, receipts get lost, and finance re-types everything for payroll.

## 4. Business objectives and success metrics

| KPI | Baseline | Target | Measured by |
| --- | --- | --- | --- |
| 90% of claims decided within 2 working days; finance spreadsheet use for claims ends within 1 month; claim submission takes under 2 minutes. | Not provided | 90% of claims decided within 2 working days; finance spreadsheet use for claims ends within 1 month; claim submission takes under 2 minutes. | 90% of claims decided within 2 working days; finance spreadsheet use for claims ends within 1 month; claim submission takes under 2 minutes. |

## 5. Scope

### In scope

Login, submit/edit/delete claims with receipts, manager approval (including viewing the claim receipt before deciding), auto-approval of small claims, duplicate warning, claim history, finance monthly report and CSV export, demo data.

### Out of scope

Paying reimbursements, multiple currencies, SSO, email notifications, receipt OCR, native mobile apps.

## 6. Stakeholders and users

| Persona / role | Description | Goals |
| --- | --- | --- |
| Employee | Submits and manages their own claims. | Create, edit, delete and submit own claims; sees only own claims. |
| Manager | Everything an Employee can do for own claims, plus approval of direct reports' claims. | Approve or reject claims of direct reports only, after viewing the receipt where one exists; can never approve own claims. |
| Finance | Read-only access to all claims, reports and exports. | View all claims, monthly reports and CSV export; cannot approve, edit or delete claims. |

## 7. High-level business requirements

| ID | Requirement | Priority (MoSCoW) |
| --- | --- | --- |
| FR-01 | Login and logout with email and password. Sessions expire after 30 minutes of inactivity. Account locked for 15 minutes after 5 consecutive failed attempts. | Must |
| FR-02 | Submit a claim with date, category, amount in INR (max 2 decimals), description (3-200 chars), optional receipt (JPG, PNG or PDF, max 2 MB). Categories: Travel, Meals, Lodging, Office Supplies, Internet & Phone, Training. | Must |
| FR-03 | Claims of 500.00 or less are auto-approved at submission, decided by 'system'. | Must |
| FR-04 | If the same employee has a non-rejected claim with the same date, category and amount, submission is blocked with a warning; allowed if the user confirms. | Must |
| FR-05 | List own claims filterable by status, month and category; newest first; 20 per page; shows total amount of the filtered list. | Must |
| FR-06 | Employees can edit or delete their own claim only while it is Submitted. | Must |
| FR-07 | Manager sees pending claims of direct reports; approves, or rejects with a comment of at least 5 characters. | Must |
| FR-08 | Every claim shows history: created, edited, approved/rejected, by whom and when. | Must |
| FR-09 | For a chosen month: approved totals by category and by employee, grand total, approved claim count, and claim counts by status. | Must |
| FR-10 | CSV export of a month's approved claims, UTF-8, columns claim_id, employee_email, employee_name, date, category, amount, description, approved_by, approved_at. Cells starting with = + - @ are prefixed with '. | Must |
| FR-11 | When SEED_DEMO_DATA=true, load seed/users.csv, seed/categories.csv and seed/claims.csv at start-up keeping CLM-nnnn IDs. Idempotent. New claims continue the sequence. | Must |
| FR-12 | GET /api/health returns status ok and semver version. | Must |
| FR-13 | A manager can view the receipt of a claim in their queue (a direct report's pending claim) before deciding. | Must |

## 8. Business rules

- BR-01: Amount from 1.00 to 100000.00 inclusive, at most 2 decimals.
- BR-02: Claim date must not be in the future (Asia/Kolkata) and not before 2026-01-01.
- BR-03: Meals claims cannot exceed 2000.00 each.
- BR-04: A receipt is mandatory when the amount is above 2000.00.
- BR-05: Auto-approve when amount <= 500.00; such claims are locked immediately (BR-07).
- BR-06: Nobody can approve or reject their own claim.
- BR-07: Approved or rejected claims cannot be edited or deleted.
- BR-08: Rejection needs a comment of at least 5 characters.
- BR-09: Duplicate rule as in FR-04.
- BR-10: Managers can approve or reject claims of their direct reports only; a manager's own claim is approved by their own manager.
- BR-11: Every user except the top manager (Sanjay Gupta) has exactly one manager.
- BR-12: Sanjay Gupta does not submit claims in v1.
- BR-13: Employees see only their own claims.
- BR-14: Finance has read-only access to all claims and cannot approve, edit or delete them.

## 9. Assumptions, constraints, dependencies

- v1 is demo/UAT only: no backups, data resets on redeploy.
- FR-01 account lock (5 consecutive failures) and NFR-03 per-IP limit (10 failed per minute) are complementary.
- Demo data and the known test password are acceptable in production (no real data).
- ASSUMPTION: an employee may replace the receipt while the claim is Submitted, as part of editing (FR-06).
- Meals claims never require a receipt (cap 2000.00 equals the receipt threshold); receipt is optional for Meals.
- The duplicate check (FR-04) applies to auto-approved claims too; only Rejected claims are excluded.
- ASSUMPTION: FR-13 applies only to claims that have a receipt attached; for claims without a receipt the manager sees that none was provided.

Constraints: deadline Demo-ready in 2 weeks.; budget Hosting under USD 20 per month.; team The requester is the only reviewer and approver.; existing systems None. No integration with payroll, HR or other systems in v1; finance exports a CSV..

## 10. Risks and mitigations

| Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- |
| Requirements change after approval | Medium | Medium | Version and re-approve changed documents. |

## 11. Open questions

- Security scanning of staging is not authorised; revisit if this changes.

## 12. Glossary

- **SpendWise:** Employees, managers and finance staff in a company of 50-200 people. Admins optional.
