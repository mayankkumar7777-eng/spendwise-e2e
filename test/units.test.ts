import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService, FailureLimiter, afterFailure } from '../src/auth.js';
import { csvCell, parseCsv, toCsv } from '../src/csv.js';
import { isValidIsoDate, isValidMonth, todayInKolkata } from '../src/dates.js';
import { formatPaise, parseAmount } from '../src/money.js';
import { canModify, canSubmit, canView, checkDecision } from '../src/policy.js';
import type { User } from '../src/policy.js';
import { checkReceipt } from '../src/receipts.js';
import { validateClaimFields } from '../src/validation.js';
import type { ReceiptState } from '../src/validation.js';
import { PDF, PNG } from './helpers.js';

const ctx: { today: string; receipt: ReceiptState } = { today: '2026-11-23', receipt: 'absent' };
const base = { date: '2026-11-01', category: 'Travel', amount: '100.00', description: 'Cab ride' };
const codes = (raw: Record<string, unknown>, c = ctx) => {
  const r = validateClaimFields({ ...base, ...raw }, c);
  return r.ok ? [] : r.fields.map((f) => f.code);
};

describe('money and amount rules', () => {
  it('TEST-BR-01 BR-01 amount range 1.00 to 100000.00 inclusive, max 2 decimals', () => {
    assert.deepEqual(parseAmount('1.00'), { paise: 100 });
    assert.deepEqual(parseAmount('100000.00'), { paise: 10_000_000 });
    assert.deepEqual(parseAmount(12.5), { paise: 1250 });
    assert.deepEqual(parseAmount('1.500'), { paise: 150 });
    assert.deepEqual(parseAmount('0.99'), { code: 'AMOUNT_OUT_OF_RANGE' });
    assert.deepEqual(parseAmount('100000.01'), { code: 'AMOUNT_OUT_OF_RANGE' });
    assert.deepEqual(parseAmount('99999999999'), { code: 'AMOUNT_OUT_OF_RANGE' });
    assert.deepEqual(parseAmount('10.001'), { code: 'AMOUNT_PRECISION' });
    for (const bad of ['abc', '', '-5', '1e3', null, undefined, NaN, {}]) {
      assert.deepEqual(parseAmount(bad), { code: 'AMOUNT_INVALID' });
    }
  });

  it('TEST-AC-02-2 FR-02 money is formatted as a 2 decimal string', () => {
    assert.equal(formatPaise(123450), '1234.50');
    assert.equal(formatPaise(5), '0.05');
    assert.equal(formatPaise(-250), '-2.50');
  });
});

describe('dates', () => {
  it('TEST-BR-02 BR-02 uses Asia/Kolkata for today and validates ISO dates and months', () => {
    assert.equal(todayInKolkata(new Date('2026-11-23T19:00:00Z')), '2026-11-24');
    assert.equal(isValidIsoDate('2026-02-29'), false);
    assert.equal(isValidIsoDate('2026-02-28'), true);
    assert.equal(isValidIsoDate('26-1-1'), false);
    assert.equal(isValidMonth('2026-13'), false);
    assert.equal(isValidMonth('2026-12'), true);
  });
});

describe('claim validation', () => {
  it('TEST-AC-02-1 FR-02 accepts a valid claim', () => {
    const r = validateClaimFields(base, ctx);
    assert.ok(r.ok);
    assert.equal(r.ok && r.value.amountPaise, 10000);
  });

  it('TEST-BR-02 BR-02 rejects future dates and dates before 2026-01-01', () => {
    assert.deepEqual(codes({ date: '2026-11-24' }), ['DATE_IN_FUTURE']);
    assert.deepEqual(codes({ date: '2025-12-31' }), ['DATE_BEFORE_POLICY_START']);
    assert.deepEqual(codes({ date: '2026-01-01' }), []);
    assert.deepEqual(codes({ date: 'nope' }), ['DATE_INVALID']);
    assert.deepEqual(codes({ date: 5 }), ['DATE_INVALID']);
  });

  it('TEST-AC-02-2 FR-02 category and description rules', () => {
    assert.deepEqual(codes({ category: 'Fun' }), ['INVALID_CATEGORY']);
    assert.deepEqual(codes({ description: 'ab' }), ['DESCRIPTION_LENGTH']);
    assert.deepEqual(codes({ description: '  a  ' }), ['DESCRIPTION_LENGTH']);
    assert.deepEqual(codes({ description: 'x'.repeat(201) }), ['DESCRIPTION_LENGTH']);
    assert.deepEqual(codes({ description: 'x'.repeat(200) }), []);
    assert.deepEqual(codes({ description: '😀'.repeat(200) }), []);
    assert.deepEqual(codes({ description: 42 }), ['DESCRIPTION_LENGTH']);
  });

  it('TEST-BR-03 BR-03 Meals cannot exceed 2000.00', () => {
    assert.deepEqual(codes({ category: 'Meals', amount: '2000.01' }), ['MEALS_LIMIT_EXCEEDED']);
    assert.deepEqual(codes({ category: 'Meals', amount: '2000.00' }), []);
  });

  it('TEST-BR-04 BR-04 receipt mandatory above 2000.00 except where invalid or present', () => {
    assert.deepEqual(codes({ amount: '2000.01' }), ['RECEIPT_REQUIRED']);
    assert.deepEqual(codes({ amount: '2000.00' }), []);
    assert.deepEqual(codes({ amount: '2000.01' }, { ...ctx, receipt: 'present' }), []);
    assert.deepEqual(codes({ amount: '2000.01' }, { ...ctx, receipt: 'invalid' }), []);
  });
});

describe('receipts', () => {
  it('TEST-AC-02-3 FR-02 detects JPG, PNG, PDF by content and rejects others', () => {
    assert.deepEqual(checkReceipt(PNG, false), { ok: true, mime: 'image/png', ext: 'png' });
    assert.deepEqual(checkReceipt(PDF, false), { ok: true, mime: 'application/pdf', ext: 'pdf' });
    assert.deepEqual(checkReceipt(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), false), { ok: true, mime: 'image/jpeg', ext: 'jpg' });
    const text = checkReceipt(Buffer.from('hello'), false);
    assert.ok(!text.ok && text.error.code === 'FILE_TYPE_NOT_ALLOWED');
    const big = checkReceipt(PNG, true);
    assert.ok(!big.ok && big.error.code === 'FILE_TOO_LARGE');
    const huge = checkReceipt(Buffer.alloc(2 * 1024 * 1024 + 1, 1), false);
    assert.ok(!huge.ok && huge.error.code === 'FILE_TOO_LARGE');
  });
});

describe('csv', () => {
  it('TEST-AC-10-2 FR-10 prefixes formula cells with a quote', () => {
    for (const c of ['=SUM(A1)', '+1', '-1', '@x']) assert.equal(csvCell(c), `'${c}`);
    assert.equal(csvCell('plain'), 'plain');
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell("=1,2"), '"\'=1,2"');
  });

  it('TEST-AC-10-1 FR-10 builds and parses CSV round trip', () => {
    const text = toCsv([['a', 'b'], ['x,y', 'z\nw'], ['१', '😀']]);
    assert.equal(text.split('\r\n')[0], 'a,b');
    assert.deepEqual(parseCsv(text), [{ a: 'x,y', b: 'z\nw' }, { a: '१', b: '😀' }]);
    assert.deepEqual(parseCsv(''), []);
    assert.deepEqual(parseCsv('\uFEFFa,b\r\n1,2'), [{ a: '1', b: '2' }]);
  });
});

const user = (over: Partial<User>): User => ({ id: 'u', email: 'u@x', name: 'U', role: 'Employee', managerId: 'm', ...over });

describe('policy', () => {
  const owned = { employeeId: 'e1', employeeManagerId: 'm1' };
  it('TEST-BR-06 BR-06 BR-10 decision rules', () => {
    assert.equal(checkDecision(user({ id: 'e1', role: 'Manager' }), owned), 'self');
    assert.equal(checkDecision(user({ id: 'm1', role: 'Manager' }), owned), 'ok');
    assert.equal(checkDecision(user({ id: 'm2', role: 'Manager' }), owned), 'forbidden');
    assert.equal(checkDecision(user({ id: 'm1', role: 'Employee' }), owned), 'forbidden');
    assert.equal(checkDecision(user({ id: 'f', role: 'Finance' }), owned), 'forbidden');
  });
  it('TEST-BR-13 BR-13 BR-14 view and modify rules', () => {
    assert.equal(canView(user({ id: 'e1' }), owned), true);
    assert.equal(canView(user({ id: 'm1', role: 'Manager' }), owned), true);
    assert.equal(canView(user({ id: 'f', role: 'Finance' }), owned), true);
    assert.equal(canView(user({ id: 'other' }), owned), false);
    assert.equal(canModify(user({ id: 'f', role: 'Finance' }), owned), false);
    assert.equal(canModify(user({ id: 'e1' }), owned), true);
  });
  it('TEST-BR-12 BR-12 top manager and Finance cannot submit', () => {
    assert.equal(canSubmit(user({ role: 'Manager', managerId: null })), false);
    assert.equal(canSubmit(user({ role: 'Finance' })), false);
    assert.equal(canSubmit(user({ role: 'Manager' })), true);
    assert.equal(canSubmit(user({})), true);
  });
});

describe('login protection', () => {
  it('TEST-AC-01-3 FR-01 5th consecutive failure locks for 15 minutes', () => {
    assert.deepEqual(afterFailure(3, 1000), { failed: 4, lockedUntil: 0 });
    assert.deepEqual(afterFailure(4, 1000), { failed: 0, lockedUntil: 1000 + 15 * 60 * 1000 });
  });

  it('TEST-NFR-04 NFR-04 per-IP limiter allows 10 failures per minute', () => {
    const limiter = new FailureLimiter();
    for (let i = 0; i < 10; i++) limiter.record('1.1.1.1', 0);
    assert.equal(limiter.blocked('1.1.1.1', 1000), true);
    assert.equal(limiter.blocked('2.2.2.2', 1000), false);
    assert.equal(limiter.blocked('1.1.1.1', 61_000), false);
  });

  it('TEST-AC-01-4 FR-01 unknown or missing sessions are unauthenticated', () => {
    const auth = new AuthService({} as never, () => 0);
    assert.throws(() => auth.resolve(undefined), /Log in/);
  });
});
