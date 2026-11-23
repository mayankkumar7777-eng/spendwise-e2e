import { validationFailed } from './errors.js';
import type { Ctx } from './claims.js';
import { isValidMonth } from './dates.js';
import { formatPaise } from './money.js';
import { toCsv } from './csv.js';
import { CATEGORIES } from './validation.js';

export const CSV_COLUMNS = [
  'claim_id',
  'employee_email',
  'employee_name',
  'date',
  'category',
  'amount',
  'description',
  'approved_by',
  'approved_at',
];

// The report month is the month of the claim date (assumption: the docs do not say).
export function requireMonth(month: unknown): string {
  if (typeof month !== 'string' || !isValidMonth(month)) {
    throw validationFailed([{ field: 'month', code: 'INVALID_FILTER', message: 'Month must be YYYY-MM.' }]);
  }
  return month;
}

export function monthlyReport(ctx: Ctx, monthInput: unknown) {
  const month = requireMonth(monthInput);
  const cat = ctx.db
    .prepare(
      "SELECT category, SUM(amount_paise) AS total, COUNT(*) AS n FROM claims WHERE status = 'Approved' AND SUBSTR(claim_date, 1, 7) = ? GROUP BY category",
    )
    .all(month) as { category: string; total: number; n: number }[];
  const emp = ctx.db
    .prepare(
      `SELECT u.email, u.name, SUM(c.amount_paise) AS total, COUNT(*) AS n FROM claims c JOIN users u ON u.id = c.employee_id
       WHERE c.status = 'Approved' AND SUBSTR(c.claim_date, 1, 7) = ? GROUP BY u.id ORDER BY u.name, u.email`,
    )
    .all(month) as { email: string; name: string; total: number; n: number }[];
  const counts = ctx.db
    .prepare('SELECT status, COUNT(*) AS n FROM claims WHERE SUBSTR(claim_date, 1, 7) = ? GROUP BY status')
    .all(month) as { status: string; n: number }[];
  const statusCounts: Record<string, number> = { Submitted: 0, Approved: 0, Rejected: 0 };
  for (const row of counts) statusCounts[row.status] = row.n;
  const byCat = new Map(cat.map((r) => [r.category, r]));
  const grand = cat.reduce((sum, r) => sum + r.total, 0);
  return {
    month,
    byCategory: CATEGORIES.map((name) => ({
      category: name,
      total: formatPaise(byCat.get(name)?.total ?? 0),
      count: byCat.get(name)?.n ?? 0,
    })),
    byEmployee: emp.map((r) => ({ employeeEmail: r.email, employeeName: r.name, total: formatPaise(r.total), count: r.n })),
    statusCounts,
    grandTotal: formatPaise(grand),
    approvedCount: statusCounts.Approved,
  };
}

export function monthlyCsv(ctx: Ctx, monthInput: unknown): string {
  const month = requireMonth(monthInput);
  const rows = ctx.db
    .prepare(
      `SELECT c.id, e.email, e.name, c.claim_date, c.category, c.amount_paise, c.description, c.decided_by,
         d.email AS decider_email, c.decided_at
       FROM claims c JOIN users e ON e.id = c.employee_id LEFT JOIN users d ON d.id = c.decided_by
       WHERE c.status = 'Approved' AND SUBSTR(c.claim_date, 1, 7) = ? ORDER BY CAST(SUBSTR(c.id, 5) AS INTEGER)`,
    )
    .all(month) as {
    id: string;
    email: string;
    name: string;
    claim_date: string;
    category: string;
    amount_paise: number;
    description: string;
    decided_by: string | null;
    decider_email: string | null;
    decided_at: string | null;
  }[];
  return toCsv([
    CSV_COLUMNS,
    ...rows.map((r) => [
      r.id,
      r.email,
      r.name,
      r.claim_date,
      r.category,
      formatPaise(r.amount_paise),
      r.description,
      r.decided_by === 'system' ? 'system' : (r.decider_email ?? ''),
      r.decided_at ?? '',
    ]),
  ]);
}
