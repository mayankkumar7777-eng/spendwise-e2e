import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db.js';
import { AppError, unauthenticated, validationFailed } from './errors.js';
import type { Role, User } from './policy.js';

export const BCRYPT_COST = 12;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;
export const IP_FAILURES_PER_MINUTE = 10;

// FR-01 lockout state machine: the 5th consecutive failure locks the account for 15 minutes.
export function afterFailure(failed: number, now: number): { failed: number; lockedUntil: number } {
  const next = failed + 1;
  return next >= MAX_FAILED_ATTEMPTS ? { failed: 0, lockedUntil: now + LOCK_MS } : { failed: next, lockedUntil: 0 };
}

// NFR-03: per-IP limit on failed logins within a sliding minute.
export class FailureLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limit = IP_FAILURES_PER_MINUTE) {}

  private recent(ip: string, now: number): number[] {
    const list = (this.hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (list.length > 0) this.hits.set(ip, list);
    else this.hits.delete(ip);
    return list;
  }

  blocked(ip: string, now: number): boolean {
    return this.recent(ip, now).length >= this.limit;
  }

  record(ip: string, now: number): void {
    this.hits.set(ip, [...this.recent(ip, now), now]);
  }
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  manager_id: string | null;
  password_hash: string;
  failed_attempts: number;
  locked_until: number;
}

export const toUser = (row: Pick<UserRow, 'id' | 'email' | 'name' | 'role' | 'manager_id'>): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  managerId: row.manager_id,
});

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export class AuthService {
  private dummyHash: Promise<string> | undefined;
  readonly limiter = new FailureLimiter();

  constructor(
    private readonly db: Db,
    private readonly now: () => number,
  ) {}

  async login(emailInput: unknown, password: unknown, ip: string): Promise<{ user: User; token: string }> {
    if (typeof emailInput !== 'string' || typeof password !== 'string' || !emailInput.trim() || !password) {
      throw validationFailed([
        { field: 'email', code: 'REQUIRED', message: 'Email and password are required.' },
      ]);
    }
    const now = this.now();
    if (this.limiter.blocked(ip, now)) {
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed login attempts. Try again in a minute.');
    }
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(emailInput.trim().toLowerCase()) as
      | UserRow
      | undefined;
    if (row && row.locked_until > now) {
      throw new AppError(423, 'ACCOUNT_LOCKED', 'Account is locked. Try again later.');
    }
    // Compare against a dummy hash for unknown emails so timing does not reveal whether an account exists.
    this.dummyHash ??= bcrypt.hash('not-a-real-password', BCRYPT_COST);
    const ok = await bcrypt.compare(password, row ? row.password_hash : await this.dummyHash);
    if (!row || !ok) {
      this.limiter.record(ip, now);
      if (row) {
        const state = afterFailure(row.failed_attempts, now);
        this.db
          .prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
          .run(state.failed, state.lockedUntil, row.id);
      }
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    this.db.prepare('UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?').run(row.id);
    const token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO sessions (id, user_id, last_seen_at) VALUES (?, ?, ?)').run(hashToken(token), row.id, now);
    return { user: toUser(row), token };
  }

  resolve(token: string | undefined): User {
    if (!token) throw unauthenticated();
    const id = hashToken(token);
    const now = this.now();
    const session = this.db.prepare('SELECT user_id, last_seen_at FROM sessions WHERE id = ?').get(id) as
      | { user_id: string; last_seen_at: number }
      | undefined;
    if (!session) throw unauthenticated();
    if (now - session.last_seen_at > SESSION_IDLE_MS) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      throw unauthenticated();
    }
    this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, id);
    const row = this.db.prepare('SELECT id, email, name, role, manager_id FROM users WHERE id = ?').get(session.user_id) as
      | UserRow
      | undefined;
    if (!row) throw unauthenticated();
    return toUser(row);
  }

  logout(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
  }
}
