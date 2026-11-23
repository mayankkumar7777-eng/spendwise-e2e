import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BCRYPT_COST } from './auth.js';
import { parseCsv } from './csv.js';
import type { Db } from './db.js';
import { isValidIsoDate } from './dates.js';
import { addEvent } from './claims.js';
import { parseAmount } from './money.js';
import { CATEGORIES } from './validation.js';

export const SEED_PASSWORD = 'Spend@Test2026';
export const TOP_MANAGER_NAME = 'Sanjay Gupta';

const read = (dir: string, file: string) => parseCsv(readFileSync(join(dir, file), 'utf8'));

// FR-11: idempotent loader. Users and claims are keyed by email and CLM id, so restarts add nothing.
export async function seedDemoData(db: Db, seedDir: string, password = process.env.SEED_PASSWORD ?? SEED_PASSWORD) {
  const categories = read(seedDir, 'categories.csv');
  const users = read(seedDir, 'users.csv');
  const claims = read(seedDir, 'claims.csv');

  const tops = users.filter((u) => !u.manager_email);
  if (tops.length !== 1 || tops[0].name !== TOP_MANAGER_NAME) {
    throw new Error(`Seed users: only ${TOP_MANAGER_NAME} may have no manager (BR-11)`);
  }
  // One hash is shared by all seed accounts (they share one known test password).
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  const byEmail = new Map<string, string>();

  db.transaction(() => {
    for (const c of categories) {
      if (!(CATEGORIES as readonly string[]).includes(c.name)) throw new Error(`Seed category invalid: ${c.name}`);
      db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(c.name);
    }
    for (const u of users) {
      const email = u.email.toLowerCase();
      if (!['Employee', 'Manager', 'Finance'].includes(u.role)) throw new Error(`Seed user role invalid: ${email}`);
      db.prepare('INSERT OR IGNORE INTO users (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)').run(
        randomUUID(),
        email,
        u.name,
        u.role,
        hash,
      );
      byEmail.set(email, (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id);
    }
    for (const u of users) {
      if (!u.manager_email) continue;
      const managerId = byEmail.get(u.manager_email.toLowerCase());
      const userId = byEmail.get(u.email.toLowerCase());
      if (!managerId || !userId) throw new Error(`Seed manager not found for ${u.email}`);
      db.prepare('UPDATE users SET manager_id = ? WHERE id = ?').run(managerId, userId);
    }
    const insert = db.prepare(
      `INSERT OR IGNORE INTO claims (id, employee_id, claim_date, category, amount_paise, description, status,
        decided_by, decided_at, decision_comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of claims) {
      if (!/^CLM-\d{4,}$/.test(c.id)) throw new Error(`Seed claim id invalid: ${c.id}`);
      const employeeId = byEmail.get(c.employee_email.toLowerCase());
      const amount = parseAmount(c.amount);
      if (!employeeId || 'code' in amount || !isValidIsoDate(c.date) || !['Submitted', 'Approved', 'Rejected'].includes(c.status)) {
        throw new Error(`Seed claim invalid: ${c.id}`);
      }
      if (c.employee_email.toLowerCase() === users.find((u) => !u.manager_email)?.email.toLowerCase()) {
        throw new Error(`Seed claim ${c.id} belongs to ${TOP_MANAGER_NAME} (BR-12)`);
      }
      const deciderId = c.decided_by === 'system' ? 'system' : c.decided_by ? byEmail.get(c.decided_by.toLowerCase()) : null;
      if (c.decided_by && !deciderId) throw new Error(`Seed claim decider unknown: ${c.id}`);
      const createdAt = `${c.date}T04:00:00.000Z`;
      const result = insert.run(
        c.id,
        employeeId,
        c.date,
        c.category,
        amount.paise,
        c.description,
        c.status,
        deciderId ?? null,
        c.decided_at || null,
        c.comment || null,
        createdAt,
        c.decided_at || createdAt,
      );
      if (result.changes === 1) {
        addEvent(db, c.id, 'created', employeeId, createdAt, null);
        if (c.status !== 'Submitted' && deciderId) {
          addEvent(db, c.id, c.status === 'Approved' ? 'approved' : 'rejected', deciderId, c.decided_at || createdAt, c.comment || null);
        }
      }
    }
  })();
}
