import type { Db } from './db.js';
import { AppError, claimLocked, forbidden, notFound, validationFailed } from './errors.js';
import type { FieldError } from './errors.js';
import { isValidMonth, todayInKolkata } from './dates.js';
import { AUTO_APPROVE_MAX_PAISE, formatPaise } from './money.js';
import { canModify, canSubmit, canView } from './policy.js';
import type { User } from './policy.js';
import { checkReceipt, removeReceipt, storeReceipt } from './receipts.js';
import type { StoredReceipt } from './receipts.js';
import { CATEGORIES, validateClaimFields } from './validation.js';
import type { ReceiptState } from './validation.js';

export interface Ctx {
  db: Db;
  receiptsDir: string;
  now: () => Date;
}

export interface Upload {
  data: Buffer;
  truncated: boolean;
}

export interface ClaimPayload {
  fields: Record<string, unknown>;
  upload?: Upload;
}

export const PAGE_SIZE = 20;
export const STATUSES = ['Submitted', 'Approved', 'Rejected'] as const;

interface ClaimRow {
  id: string;
  employee_id: string;
  claim_date: string;
  category: string;
  amount_paise: number;
  description: string;
  receipt_file: string | null;
  receipt_mime: string | null;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  created_at: string;
  updated_at: string;
  employee_email: string;
  employee_name: string;
  employee_manager_id: string | null;
  decided_by_email: string | null;
}

export const CLAIM_SELECT = `SELECT c.*, e.email AS employee_email, e.name AS employee_name,
  e.manager_id AS employee_manager_id, d.email AS decided_by_email
  FROM claims c JOIN users e ON e.id = c.employee_id LEFT JOIN users d ON d.id = c.decided_by`;

export function loadClaimRow(db: Db, id: string): ClaimRow | undefined {
  return db.prepare(`${CLAIM_SELECT} WHERE c.id = ?`).get(id) as ClaimRow | undefined;
}

export function toClaim(row: ClaimRow) {
  return {
    id: row.id,
    employeeEmail: row.employee_email,
    employeeName: row.employee_name,
    date: row.claim_date,
    category: row.category,
    amount: formatPaise(row.amount_paise),
    description: row.description,
    hasReceipt: row.receipt_file !== null,
    status: row.status,
    decidedBy: row.decided_by === 'system' ? 'system' : row.decided_by_email,
    decidedAt: row.decided_at,
    decisionComment: row.decision_comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function addEvent(db: Db, claimId: string, type: string, actor: string, at: string, comment: string | null) {
  db.prepare('INSERT INTO claim_events (claim_id, type, actor, at, comment) VALUES (?, ?, ?, ?, ?)').run(
    claimId,
    type,
    actor,
    at,
    comment,
  );
}

export function nextClaimId(db: Db): string {
  const row = db.prepare("SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS n FROM claims WHERE id LIKE 'CLM-%'").get() as {
    n: number | null;
  };
  return `CLM-${String((row.n ?? 0) + 1).padStart(4, '0')}`;
}

function readUpload(payload: ClaimPayload): { state: ReceiptState; error?: FieldError; stored?: { data: Buffer; mime: string; ext: string } } {
  if (!payload.upload) return { state: 'absent' };
  const check = checkReceipt(payload.upload.data, payload.upload.truncated);
  if (!check.ok) return { state: 'invalid', error: check.error };
  return { state: 'present', stored: { data: payload.upload.data, mime: check.mime, ext: check.ext } };
}

export function createClaim(ctx: Ctx, user: User, payload: ClaimPayload) {
  if (!canSubmit(user)) throw forbidden();
  const upload = readUpload(payload);
  const result = validateClaimFields(payload.fields, { today: todayInKolkata(ctx.now()), receipt: upload.state });
  const errors = [...(result.ok ? [] : result.fields), ...(upload.error ? [upload.error] : [])];
  if (!result.ok || errors.length > 0) throw validationFailed(errors);
  const value = result.value;

  const confirm = payload.fields.confirmDuplicate === true || payload.fields.confirmDuplicate === 'true';
  if (!confirm) {
    const dup = ctx.db
      .prepare(
        "SELECT id FROM claims WHERE employee_id = ? AND claim_date = ? AND category = ? AND amount_paise = ? AND status <> 'Rejected' LIMIT 1",
      )
      .get(user.id, value.date, value.category, value.amountPaise) as { id: string } | undefined;
    if (dup) {
      throw new AppError(409, 'DUPLICATE_CLAIM', 'A similar claim already exists. Confirm to submit anyway.');
    }
  }

  let receipt: StoredReceipt | null = null;
  if (upload.stored) receipt = storeReceipt(ctx.receiptsDir, upload.stored.data, upload.stored.mime, upload.stored.ext);
  const nowIso = ctx.now().toISOString();
  const auto = value.amountPaise <= AUTO_APPROVE_MAX_PAISE;
  try {
    const id = ctx.db.transaction(() => {
      const claimId = nextClaimId(ctx.db);
      ctx.db
        .prepare(
          `INSERT INTO claims (id, employee_id, claim_date, category, amount_paise, description, receipt_file, receipt_mime,
            status, decided_by, decided_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          claimId,
          user.id,
          value.date,
          value.category,
          value.amountPaise,
          value.description,
          receipt?.file ?? null,
          receipt?.mime ?? null,
          auto ? 'Approved' : 'Submitted',
          auto ? 'system' : null,
          auto ? nowIso : null,
          nowIso,
          nowIso,
        );
      addEvent(ctx.db, claimId, 'created', user.id, nowIso, null);
      if (auto) addEvent(ctx.db, claimId, 'approved', 'system', nowIso, null);
      return claimId;
    })();
    return toClaim(loadClaimRow(ctx.db, id)!);
  } catch (error) {
    removeReceipt(ctx.receiptsDir, receipt?.file ?? null);
    throw error;
  }
}

export interface ListFilters {
  status?: string;
  month?: string;
  category?: string;
  page?: string;
}

export function listClaims(ctx: Ctx, user: User, filters: ListFilters) {
  const errors: FieldError[] = [];
  const bad = (field: string, message: string) => errors.push({ field, code: 'INVALID_FILTER', message });
  if (filters.status && !(STATUSES as readonly string[]).includes(filters.status)) bad('status', 'Select a valid status.');
  if (filters.month && !isValidMonth(filters.month)) bad('month', 'Month must be YYYY-MM.');
  if (filters.category && !(CATEGORIES as readonly string[]).includes(filters.category)) bad('category', 'Select a valid category.');
  let page = 1;
  if (filters.page !== undefined && filters.page !== '') {
    if (!/^\d{1,6}$/.test(filters.page) || Number(filters.page) < 1) bad('page', 'Page must be a positive integer.');
    else page = Number(filters.page);
  }
  if (errors.length > 0) throw validationFailed(errors);

  const where: string[] = [];
  const params: (string | number)[] = [];
  // Finance has read-only access to all claims (BR-14); everyone else sees only their own (BR-13).
  if (user.role !== 'Finance') {
    where.push('c.employee_id = ?');
    params.push(user.id);
  }
  if (filters.status) {
    where.push('c.status = ?');
    params.push(filters.status);
  }
  if (filters.month) {
    where.push('SUBSTR(c.claim_date, 1, 7) = ?');
    params.push(filters.month);
  }
  if (filters.category) {
    where.push('c.category = ?');
    params.push(filters.category);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totals = ctx.db
    .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(c.amount_paise), 0) AS sum FROM claims c ${clause}`)
    .get(...params) as { total: number; sum: number };
  const rows = ctx.db
    .prepare(
      `${CLAIM_SELECT} ${clause} ORDER BY c.created_at DESC, CAST(SUBSTR(c.id, 5) AS INTEGER) DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE) as ClaimRow[];
  return {
    items: rows.map(toClaim),
    total: totals.total,
    page,
    pageSize: PAGE_SIZE,
    sumAmount: formatPaise(totals.sum),
  };
}

export function loadAuthorised(ctx: Ctx, user: User, id: string): ClaimRow {
  const row = loadClaimRow(ctx.db, id);
  if (!row) throw notFound();
  if (!canView(user, { employeeId: row.employee_id, employeeManagerId: row.employee_manager_id })) throw forbidden();
  return row;
}

export function getClaim(ctx: Ctx, user: User, id: string) {
  const row = loadAuthorised(ctx, user, id);
  const history = ctx.db
    .prepare(
      `SELECT ev.type, ev.at, ev.comment, ev.actor, u.email AS actor_email, u.name AS actor_name
       FROM claim_events ev LEFT JOIN users u ON u.id = ev.actor WHERE ev.claim_id = ? ORDER BY ev.id`,
    )
    .all(id) as { type: string; at: string; comment: string | null; actor: string; actor_email: string | null; actor_name: string | null }[];
  return {
    ...toClaim(row),
    history: history.map((h) => ({
      type: h.type,
      actor: h.actor === 'system' ? 'system' : h.actor_email,
      actorName: h.actor === 'system' ? 'system' : h.actor_name,
      at: h.at,
      comment: h.comment,
    })),
  };
}

function loadOwned(ctx: Ctx, user: User, id: string): ClaimRow {
  const row = loadClaimRow(ctx.db, id);
  if (!row) throw notFound();
  const ownership = { employeeId: row.employee_id, employeeManagerId: row.employee_manager_id };
  if (!canView(user, ownership) || !canModify(user, ownership)) throw forbidden();
  if (row.status !== 'Submitted') throw claimLocked();
  return row;
}

export function updateClaim(ctx: Ctx, user: User, id: string, payload: ClaimPayload) {
  const row = loadOwned(ctx, user, id);
  const upload = readUpload(payload);
  const merged = {
    date: payload.fields.date ?? row.claim_date,
    category: payload.fields.category ?? row.category,
    amount: payload.fields.amount ?? formatPaise(row.amount_paise),
    description: payload.fields.description ?? row.description,
  };
  const receiptState: ReceiptState = upload.state === 'absent' ? (row.receipt_file ? 'present' : 'absent') : upload.state;
  const result = validateClaimFields(merged, { today: todayInKolkata(ctx.now()), receipt: receiptState });
  const errors = [...(result.ok ? [] : result.fields), ...(upload.error ? [upload.error] : [])];
  if (!result.ok || errors.length > 0) throw validationFailed(errors);
  const value = result.value;

  let receipt: StoredReceipt | null = null;
  if (upload.stored) receipt = storeReceipt(ctx.receiptsDir, upload.stored.data, upload.stored.mime, upload.stored.ext);
  const nowIso = ctx.now().toISOString();
  try {
    ctx.db.transaction(() => {
      ctx.db
        .prepare(
          `UPDATE claims SET claim_date = ?, category = ?, amount_paise = ?, description = ?,
            receipt_file = ?, receipt_mime = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          value.date,
          value.category,
          value.amountPaise,
          value.description,
          receipt ? receipt.file : row.receipt_file,
          receipt ? receipt.mime : row.receipt_mime,
          nowIso,
          id,
        );
      addEvent(ctx.db, id, 'edited', user.id, nowIso, null);
    })();
  } catch (error) {
    removeReceipt(ctx.receiptsDir, receipt?.file ?? null);
    throw error;
  }
  if (receipt) removeReceipt(ctx.receiptsDir, row.receipt_file);
  return toClaim(loadClaimRow(ctx.db, id)!);
}

export function deleteClaim(ctx: Ctx, user: User, id: string): void {
  const row = loadOwned(ctx, user, id);
  ctx.db.prepare('DELETE FROM claims WHERE id = ?').run(id);
  removeReceipt(ctx.receiptsDir, row.receipt_file);
}
