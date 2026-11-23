import { AppError, claimLocked, forbidden, notFound, validationFailed } from './errors.js';
import { CLAIM_SELECT, addEvent, loadClaimRow, loadAuthorised, toClaim } from './claims.js';
import type { Ctx } from './claims.js';
import { checkDecision } from './policy.js';
import type { User } from './policy.js';
import { join } from 'node:path';

export const MIN_COMMENT_LENGTH = 5;

export function teamClaims(ctx: Ctx, user: User, status: string | undefined) {
  if (user.role !== 'Manager') throw forbidden();
  const wanted = status ?? 'Submitted';
  if (!['Submitted', 'Approved', 'Rejected'].includes(wanted)) {
    throw validationFailed([{ field: 'status', code: 'INVALID_FILTER', message: 'Select a valid status.' }]);
  }
  const rows = ctx.db
    .prepare(`${CLAIM_SELECT} WHERE e.manager_id = ? AND c.status = ? ORDER BY c.created_at ASC, c.id ASC`)
    .all(user.id, wanted) as Parameters<typeof toClaim>[0][];
  return { items: rows.map(toClaim), total: rows.length };
}

function decide(ctx: Ctx, user: User, id: string, decision: 'Approved' | 'Rejected', comment: string | null) {
  const row = loadClaimRow(ctx.db, id);
  if (!row) throw notFound();
  const check = checkDecision(user, { employeeId: row.employee_id, employeeManagerId: row.employee_manager_id });
  if (check === 'self') {
    throw new AppError(403, 'SELF_APPROVAL_NOT_ALLOWED', 'You cannot approve or reject your own claim.');
  }
  if (check === 'forbidden') throw forbidden();
  if (decision === 'Rejected' && (comment ?? '').trim().length < MIN_COMMENT_LENGTH) {
    throw new AppError(422, 'COMMENT_REQUIRED', 'A rejection comment of at least 5 characters is required.');
  }
  const nowIso = ctx.now().toISOString();
  const changed = ctx.db.transaction(() => {
    const result = ctx.db
      .prepare(
        "UPDATE claims SET status = ?, decided_by = ?, decided_at = ?, decision_comment = ?, updated_at = ? WHERE id = ? AND status = 'Submitted'",
      )
      .run(decision, user.id, nowIso, comment?.trim() ?? null, nowIso, id);
    if (result.changes === 1) {
      addEvent(ctx.db, id, decision === 'Approved' ? 'approved' : 'rejected', user.id, nowIso, comment?.trim() ?? null);
    }
    return result.changes;
  })();
  if (changed !== 1) throw claimLocked();
  return toClaim(loadClaimRow(ctx.db, id)!);
}

export const approveClaim = (ctx: Ctx, user: User, id: string) => decide(ctx, user, id, 'Approved', null);
export const rejectClaim = (ctx: Ctx, user: User, id: string, comment: unknown) =>
  decide(ctx, user, id, 'Rejected', typeof comment === 'string' ? comment : '');

// FR-13 / NFR-05: owner, their manager and Finance only.
export function receiptFor(ctx: Ctx, user: User, id: string): { path: string; mime: string } {
  const row = loadAuthorised(ctx, user, id);
  if (!row.receipt_file || !row.receipt_mime) throw notFound();
  return { path: join(ctx.receiptsDir, row.receipt_file), mime: row.receipt_mime };
}
