import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { PASSWORD, PDF, PNG, U, claim, fieldCodes, makeApp, multipart } from './helpers.js';
import type { TestApp } from './helpers.js';

const json = (res: { body: string }) => JSON.parse(res.body);

describe('auth (FR-01)', () => {
  let t: TestApp;
  before(async () => { t = await makeApp(); });
  after(async () => { await t.app.close(); rmSync(t.dir, { recursive: true, force: true }); });

  it('TEST-AC-01-1 FR-01 AC-01.1 valid login returns user and HttpOnly session cookie', async () => {
    const res = await t.call('POST', '/api/auth/login', undefined, { email: U.amit.toUpperCase(), password: PASSWORD });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).email, U.amit);
    assert.equal('passwordHash' in json(res), false);
    const cookie = String(res.headers['set-cookie']);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /Secure/);
    const secure = await t.call('POST', '/api/auth/login', undefined, { email: U.amit, password: PASSWORD }, { 'x-forwarded-proto': 'https' });
    assert.match(String(secure.headers['set-cookie']), /Secure/);
    const me = await t.call('GET', '/api/me', String(res.headers['set-cookie']).split(';')[0]);
    assert.equal(me.statusCode, 200);
    assert.equal(json(me).role, 'Employee');
  });

  it('TEST-AC-01-2 FR-01 AC-01.2 wrong credentials give 401 INVALID_CREDENTIALS', async () => {
    const wrong = await t.call('POST', '/api/auth/login', undefined, { email: U.amit, password: 'nope' });
    assert.equal(wrong.statusCode, 401);
    assert.equal(json(wrong).error.code, 'INVALID_CREDENTIALS');
    const unknown = await t.call('POST', '/api/auth/login', undefined, { email: 'ghost@x.example', password: 'nope' });
    assert.equal(unknown.statusCode, 401);
    assert.equal(json(unknown).error.message, json(wrong).error.message);
    const missing = await t.call('POST', '/api/auth/login', undefined, {});
    assert.equal(missing.statusCode, 422);
  });

  it('TEST-AC-01-3 FR-01 AC-01.3 account locks after 5 consecutive failures and unlocks after 15 minutes', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await t.call('POST', '/api/auth/login', undefined, { email: U.neha, password: 'bad' });
      assert.equal(r.statusCode, 401);
    }
    const locked = await t.call('POST', '/api/auth/login', undefined, { email: U.neha, password: PASSWORD });
    assert.equal(locked.statusCode, 423);
    assert.equal(json(locked).error.code, 'ACCOUNT_LOCKED');
    t.clock.time += 16 * 60 * 1000;
    const ok = await t.call('POST', '/api/auth/login', undefined, { email: U.neha, password: PASSWORD });
    assert.equal(ok.statusCode, 200);
  });

  it('TEST-AC-01-4 FR-01 AC-01.4 session expires after 30 minutes idle and logout ends it', async () => {
    const cookie = await t.login(U.vikram);
    t.clock.time += 20 * 60 * 1000;
    assert.equal((await t.call('GET', '/api/me', cookie)).statusCode, 200);
    t.clock.time += 20 * 60 * 1000;
    assert.equal((await t.call('GET', '/api/me', cookie)).statusCode, 200);
    t.clock.time += 31 * 60 * 1000;
    const expired = await t.call('GET', '/api/me', cookie);
    assert.equal(expired.statusCode, 401);
    assert.equal(json(expired).error.code, 'UNAUTHENTICATED');
    const res = await t.call('POST', '/api/auth/login', undefined, { email: U.vikram, password: PASSWORD });
    const fresh = String(res.headers['set-cookie']).split(';')[0];
    const out = await t.call('POST', '/api/auth/logout', fresh);
    assert.equal(out.statusCode, 204);
    assert.equal((await t.call('GET', '/api/me', fresh)).statusCode, 401);
  });
});

describe('claims (FR-02..FR-06, BR-01..BR-09)', () => {
  let t: TestApp;
  before(async () => { t = await makeApp(); });
  after(async () => { await t.app.close(); rmSync(t.dir, { recursive: true, force: true }); });

  it('TEST-AC-02-1 FR-02 AC-02.1 valid claim returns 201 with the claim', async () => {
    const res = await t.call('POST', '/api/claims', await t.login(U.amit), claim({ description: 'चाय ☕ café' }));
    assert.equal(res.statusCode, 201);
    const body = json(res);
    assert.match(body.id, /^CLM-\d{4}$/);
    assert.equal(body.amount, '750.00');
    assert.equal(body.status, 'Submitted');
    assert.equal(body.description, 'चाय ☕ café');
  });

  it('TEST-AC-02-2 FR-02 AC-02.2 invalid fields give 422 VALIDATION_FAILED with per-field codes', async () => {
    const res = await t.call('POST', '/api/claims', await t.login(U.amit), { date: '2027-01-01', category: 'X', amount: '0.5', description: 'a' });
    assert.equal(res.statusCode, 422);
    assert.equal(json(res).error.code, 'VALIDATION_FAILED');
    assert.deepEqual(fieldCodes(res.body).sort(), ['AMOUNT_OUT_OF_RANGE', 'DATE_IN_FUTURE', 'DESCRIPTION_LENGTH', 'INVALID_CATEGORY']);
    assert.equal(json(res).error.fields[0].message.length > 0, true);
    const bad = await t.call('POST', '/api/claims', await t.login(U.amit), [1]);
    assert.equal(bad.statusCode, 400);
  });

  it('TEST-AC-02-3 FR-02 AC-02.3 receipt over 2 MB or wrong type is rejected', async () => {
    const cookie = await t.login(U.amit);
    const big = multipart({ ...claim({ amount: '2500.00', date: '2026-11-02' }) }, { name: 'r.png', data: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]), type: 'image/png' });
    const r1 = await t.call('POST', '/api/claims', cookie, big.payload, big.headers);
    assert.equal(r1.statusCode, 422);
    assert.deepEqual(fieldCodes(r1.body), ['FILE_TOO_LARGE']);
    const txt = multipart({ ...claim({ amount: '2500.00', date: '2026-11-02' }) }, { name: 'r.pdf', data: Buffer.from('not a pdf'), type: 'application/pdf' });
    const r2 = await t.call('POST', '/api/claims', cookie, txt.payload, txt.headers);
    assert.deepEqual(fieldCodes(r2.body), ['FILE_TYPE_NOT_ALLOWED']);
  });

  it('TEST-BR-04 BR-04 receipt mandatory above 2000.00; accepted PDF is stored with server name', async () => {
    const cookie = await t.login(U.amit);
    const none = await t.call('POST', '/api/claims', cookie, claim({ amount: '2000.01', date: '2026-11-03' }));
    assert.deepEqual(fieldCodes(none.body), ['RECEIPT_REQUIRED']);
    const m = multipart(claim({ amount: '2000.01', date: '2026-11-03' }), { name: '../../evil.pdf', data: PDF, type: 'application/pdf' });
    const ok = await t.call('POST', '/api/claims', cookie, m.payload, m.headers);
    assert.equal(ok.statusCode, 201);
    assert.equal(json(ok).hasReceipt, true);
    assert.doesNotMatch(ok.body, /evil/);
  });

  it('TEST-BR-01 BR-01 boundary amounts', async () => {
    const cookie = await t.login(U.sneha);
    const lo = await t.call('POST', '/api/claims', cookie, claim({ amount: '1.00', date: '2026-02-01' }));
    assert.equal(lo.statusCode, 201);
    const under = await t.call('POST', '/api/claims', cookie, claim({ amount: '0.99' }));
    assert.deepEqual(fieldCodes(under.body), ['AMOUNT_OUT_OF_RANGE']);
    const over = await t.call('POST', '/api/claims', cookie, claim({ amount: 100000.01 }));
    assert.deepEqual(fieldCodes(over.body), ['AMOUNT_OUT_OF_RANGE']);
    const prec = await t.call('POST', '/api/claims', cookie, claim({ amount: '5.555' }));
    assert.deepEqual(fieldCodes(prec.body), ['AMOUNT_PRECISION']);
    const inv = await t.call('POST', '/api/claims', cookie, claim({ amount: 'x' }));
    assert.deepEqual(fieldCodes(inv.body), ['AMOUNT_INVALID']);
  });

  it('TEST-BR-02 BR-02 and BR-03 date and Meals rules through the API', async () => {
    const cookie = await t.login(U.sneha);
    const early = await t.call('POST', '/api/claims', cookie, claim({ date: '2025-12-31' }));
    assert.deepEqual(fieldCodes(early.body), ['DATE_BEFORE_POLICY_START']);
    const bad = await t.call('POST', '/api/claims', cookie, claim({ date: '2026-02-30' }));
    assert.deepEqual(fieldCodes(bad.body), ['DATE_INVALID']);
    const meals = await t.call('POST', '/api/claims', cookie, claim({ category: 'Meals', amount: '2000.01' }));
    assert.deepEqual(fieldCodes(meals.body), ['MEALS_LIMIT_EXCEEDED']);
    const today = await t.call('POST', '/api/claims', cookie, claim({ date: '2026-11-23', amount: '20.00' }));
    assert.equal(today.statusCode, 201);
  });

  it('TEST-AC-03-1 FR-03 AC-03.1 BR-05 claim of 500.00 is auto-approved by system and locked', async () => {
    const cookie = await t.login(U.vikram);
    const res = await t.call('POST', '/api/claims', cookie, claim({ amount: '500.00', date: '2026-11-04' }));
    assert.equal(res.statusCode, 201);
    assert.equal(json(res).status, 'Approved');
    assert.equal(json(res).decidedBy, 'system');
    const patch = await t.call('PATCH', `/api/claims/${json(res).id}`, cookie, { description: 'Changed text' });
    assert.equal(patch.statusCode, 409);
    assert.equal(json(patch).error.code, 'CLAIM_LOCKED');
  });

  it('TEST-AC-03-2 FR-03 AC-03.2 claim of 500.01 awaits the manager', async () => {
    const res = await t.call('POST', '/api/claims', await t.login(U.vikram), claim({ amount: '500.01', date: '2026-11-04' }));
    assert.equal(json(res).status, 'Submitted');
    assert.equal(json(res).decidedBy, null);
  });

  it('TEST-AC-04-1 FR-04 AC-04.1 BR-09 duplicate is blocked with 409', async () => {
    const cookie = await t.login(U.arjun);
    const first = await t.call('POST', '/api/claims', cookie, claim({ date: '2026-11-05', amount: '900.00' }));
    assert.equal(first.statusCode, 201);
    const dup = await t.call('POST', '/api/claims', cookie, claim({ date: '2026-11-05', amount: '900.00', description: 'Other text' }));
    assert.equal(dup.statusCode, 409);
    assert.equal(json(dup).error.code, 'DUPLICATE_CLAIM');
    const auto = await t.call('POST', '/api/claims', cookie, claim({ date: '2026-11-06', amount: '100.00' }));
    const autoDup = await t.call('POST', '/api/claims', cookie, claim({ date: '2026-11-06', amount: '100.00' }));
    assert.equal(autoDup.statusCode, 409, `auto-approved ${json(auto).id} counts as duplicate`);
    const otherUser = await t.call('POST', '/api/claims', await t.login(U.amit), claim({ date: '2026-11-05', amount: '900.00' }));
    assert.equal(otherUser.statusCode, 201);
  });

  it('TEST-AC-04-2 FR-04 AC-04.2 confirmDuplicate=true allows submission (JSON and multipart)', async () => {
    const cookie = await t.login(U.arjun);
    const ok = await t.call('POST', '/api/claims', cookie, { ...claim({ date: '2026-11-05', amount: '900.00' }), confirmDuplicate: true });
    assert.equal(ok.statusCode, 201);
    const m = multipart({ ...claim({ date: '2026-11-05', amount: '900.00' }), confirmDuplicate: 'true' });
    const ok2 = await t.call('POST', '/api/claims', cookie, m.payload, m.headers);
    assert.equal(ok2.statusCode, 201);
  });

  it('TEST-AC-04-3 FR-04 AC-04.3 a rejected match is not a duplicate', async () => {
    const cookie = await t.login(U.neha);
    const dup = await t.call('POST', '/api/claims', cookie, claim({ date: '2026-09-20', category: 'Office Supplies', amount: '1250.00', description: 'Printer cartridges' }));
    assert.equal(dup.statusCode, 201);
  });

  it('TEST-AC-05-1 FR-05 AC-05.1 newest first, 20 per page, sumAmount of the filtered list', async () => {
    const cookie = await t.login(U.rahul);
    let expected = 0;
    for (let i = 1; i <= 22; i++) {
      const amount = (i * 3 + 7).toFixed(2);
      expected += Number(amount) * 100;
      assert.equal((await t.call('POST', '/api/claims', cookie, claim({ amount, date: '2026-03-10', category: 'Training' }))).statusCode, 201);
    }
    const p1 = json(await t.call('GET', '/api/claims?month=2026-03', cookie));
    assert.equal(p1.items.length, 20);
    assert.equal(p1.pageSize, 20);
    assert.equal(p1.page, 1);
    assert.equal(p1.total, 22);
    assert.equal(p1.sumAmount, (expected / 100).toFixed(2));
    const ids = p1.items.map((c: { id: string }) => Number(c.id.slice(4)));
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
    const p2 = json(await t.call('GET', '/api/claims?month=2026-03&page=2', cookie));
    assert.equal(p2.items.length, 2);
    assert.ok(ids[ids.length - 1] > Number(p2.items[0].id.slice(4)));
  });

  it('TEST-AC-05-2 FR-05 AC-05.2 BR-13 filters apply and only own claims are listed', async () => {
    const cookie = await t.login(U.amit);
    const approved = json(await t.call('GET', '/api/claims?status=Approved&month=2026-09&category=Meals', cookie));
    assert.deepEqual(approved.items.map((c: { id: string }) => c.id), ['CLM-0001']);
    assert.equal(approved.sumAmount, '350.00');
    const all = json(await t.call('GET', '/api/claims', cookie));
    assert.ok(all.items.every((c: { employeeEmail: string }) => c.employeeEmail === U.amit));
    for (const q of ['status=Foo', 'month=2026-13', 'category=Foo', 'page=0', 'page=x']) {
      assert.equal((await t.call('GET', `/api/claims?${q}`, cookie)).statusCode, 422, q);
    }
  });

  it('TEST-AC-06-1 FR-06 AC-06.1 owner edits (with receipt replacement) and deletes a Submitted claim', async () => {
    const cookie = await t.login(U.sneha);
    const created = json(await t.call('POST', '/api/claims', cookie, claim({ date: '2026-04-01', amount: '800.00' })));
    const edited = await t.call('PATCH', `/api/claims/${created.id}`, cookie, { description: 'Updated taxi', amount: '850.00' });
    assert.equal(edited.statusCode, 200);
    assert.equal(json(edited).amount, '850.00');
    const noReceipt = await t.call('PATCH', `/api/claims/${created.id}`, cookie, { amount: '2500.00' });
    assert.deepEqual(fieldCodes(noReceipt.body), ['RECEIPT_REQUIRED']);
    const m = multipart({ amount: '2500.00' }, { name: 'a.png', data: PNG, type: 'image/png' });
    const withReceipt = await t.call('PATCH', `/api/claims/${created.id}`, cookie, m.payload, m.headers);
    assert.equal(withReceipt.statusCode, 200);
    assert.equal(json(withReceipt).hasReceipt, true);
    const m2 = multipart({}, { name: 'b.pdf', data: PDF, type: 'application/pdf' });
    assert.equal((await t.call('PATCH', `/api/claims/${created.id}`, cookie, m2.payload, m2.headers)).statusCode, 200);
    const history = json(await t.call('GET', `/api/claims/${created.id}`, cookie)).history.map((h: { type: string }) => h.type);
    assert.deepEqual(history, ['created', 'edited', 'edited', 'edited']);
    assert.equal((await t.call('DELETE', `/api/claims/${created.id}`, cookie)).statusCode, 204);
    assert.equal((await t.call('GET', `/api/claims/${created.id}`, cookie)).statusCode, 404);
  });

  it('TEST-AC-06-2 FR-06 AC-06.2 BR-07 approved or rejected claims are locked', async () => {
    const cookie = await t.login(U.amit);
    for (const id of ['CLM-0001', 'CLM-0004', 'CLM-0002']) {
      const owner = id === 'CLM-0004' ? await t.login(U.neha) : cookie;
      const patch = await t.call('PATCH', `/api/claims/${id}`, owner, { description: 'Edited text' });
      const del = await t.call('DELETE', `/api/claims/${id}`, owner);
      assert.equal(patch.statusCode, 409, id);
      assert.equal(del.statusCode, 409, id);
      assert.equal(json(del).error.code, 'CLAIM_LOCKED');
    }
  });

  it('TEST-BR-12 BR-12 BR-14 top manager and Finance cannot submit, edit or delete', async () => {
    assert.equal((await t.call('POST', '/api/claims', await t.login(U.sanjay), claim())).statusCode, 403);
    const fin = await t.login(U.anita);
    assert.equal((await t.call('POST', '/api/claims', fin, claim())).statusCode, 403);
    assert.equal((await t.call('PATCH', '/api/claims/CLM-0010', fin, { description: 'Hacked text' })).statusCode, 403);
    assert.equal((await t.call('DELETE', '/api/claims/CLM-0010', fin)).statusCode, 403);
    assert.equal((await t.call('POST', '/api/claims/CLM-0010/approve', fin)).statusCode, 403);
    const all = json(await t.call('GET', '/api/claims', fin));
    assert.ok(all.total >= 14);
  });

  it('TEST-BR-13 BR-13 an employee cannot modify or read other employees claims', async () => {
    const cookie = await t.login(U.vikram);
    assert.equal((await t.call('GET', '/api/claims/CLM-0010', cookie)).statusCode, 403);
    assert.equal((await t.call('PATCH', '/api/claims/CLM-0010', cookie, { description: 'Hacked text' })).statusCode, 403);
    assert.equal((await t.call('DELETE', '/api/claims/CLM-0010', cookie)).statusCode, 403);
    assert.equal((await t.call('GET', '/api/claims/CLM-9999', cookie)).statusCode, 404);
  });
});

describe('approvals, history and receipts (FR-07, FR-08, FR-13)', () => {
  let t: TestApp;
  let receiptClaim: string;
  before(async () => {
    t = await makeApp();
    const m = multipart(claim({ amount: '3000.00', date: '2026-11-10' }), { name: 'r.png', data: PNG, type: 'image/png' });
    const res = await t.call('POST', '/api/claims', await t.login(U.amit), m.payload, m.headers);
    receiptClaim = json(res).id;
  });
  after(async () => { await t.app.close(); rmSync(t.dir, { recursive: true, force: true }); });

  it('TEST-AC-07-1 FR-07 AC-07.1 queue shows only Submitted claims of direct reports', async () => {
    const res = await t.call('GET', '/api/team/claims?status=Submitted', await t.login(U.priya));
    const ids = json(res).items.map((c: { id: string }) => c.id).sort();
    assert.deepEqual(ids, ['CLM-0010', 'CLM-0011', receiptClaim].sort());
    const sanjay = json(await t.call('GET', '/api/team/claims', await t.login(U.sanjay)));
    assert.ok(sanjay.items.some((c: { id: string }) => c.id === 'CLM-0012'));
    assert.equal((await t.call('GET', '/api/team/claims', await t.login(U.amit))).statusCode, 403);
    assert.equal((await t.call('GET', '/api/team/claims?status=Bad', await t.login(U.priya))).statusCode, 422);
  });

  it('TEST-AC-07-2 FR-07 AC-07.2 manager approves a direct reports claim', async () => {
    const cookie = await t.login(U.priya);
    const res = await t.call('POST', '/api/claims/CLM-0010/approve', cookie);
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).status, 'Approved');
    assert.equal(json(res).decidedBy, U.priya);
    const again = await t.call('POST', '/api/claims/CLM-0010/approve', cookie);
    assert.equal(again.statusCode, 409);
    assert.equal(json(again).error.code, 'CLAIM_LOCKED');
  });

  it('TEST-AC-07-3 FR-07 AC-07.3 BR-08 short rejection comment gives 422 COMMENT_REQUIRED', async () => {
    const cookie = await t.login(U.priya);
    for (const body of [{ comment: 'no' }, {}, { comment: '    ab ' }]) {
      const res = await t.call('POST', '/api/claims/CLM-0011/reject', cookie, body);
      assert.equal(res.statusCode, 422);
      assert.equal(json(res).error.code, 'COMMENT_REQUIRED');
    }
    const ok = await t.call('POST', '/api/claims/CLM-0011/reject', cookie, { comment: 'Missing business purpose' });
    assert.equal(ok.statusCode, 200);
    assert.equal(json(ok).status, 'Rejected');
    assert.equal(json(ok).decisionComment, 'Missing business purpose');
  });

  it('TEST-AC-07-4 FR-07 AC-07.4 BR-06 manager cannot approve own claim', async () => {
    const res = await t.call('POST', '/api/claims/CLM-0012/approve', await t.login(U.priya));
    assert.equal(res.statusCode, 403);
    assert.equal(json(res).error.code, 'SELF_APPROVAL_NOT_ALLOWED');
    const rej = await t.call('POST', '/api/claims/CLM-0012/reject', await t.login(U.priya), { comment: 'Rejecting my own' });
    assert.equal(json(rej).error.code, 'SELF_APPROVAL_NOT_ALLOWED');
  });

  it('TEST-AC-07-5 FR-07 AC-07.5 BR-10 manager cannot decide non-report claims; own manager approves manager claims', async () => {
    const res = await t.call('POST', '/api/claims/CLM-0009/approve', await t.login(U.priya));
    assert.equal(res.statusCode, 403);
    assert.equal(json(res).error.code, 'FORBIDDEN');
    assert.equal((await t.call('POST', '/api/claims/CLM-0010/approve', await t.login(U.amit))).statusCode, 403);
    assert.equal((await t.call('POST', '/api/claims/CLM-9999/approve', await t.login(U.priya))).statusCode, 404);
    const ok = await t.call('POST', '/api/claims/CLM-0012/approve', await t.login(U.sanjay));
    assert.equal(ok.statusCode, 200);
  });

  it('TEST-AC-08-1 FR-08 AC-08.1 history lists events with actor and timestamp', async () => {
    const res = json(await t.call('GET', '/api/claims/CLM-0011', await t.login(U.arjun)));
    assert.deepEqual(res.history.map((h: { type: string }) => h.type), ['created', 'rejected']);
    assert.equal(res.history[0].actor, U.arjun);
    assert.equal(res.history[1].actor, U.priya);
    assert.ok(!Number.isNaN(Date.parse(res.history[1].at)));
    const auto = json(await t.call('GET', '/api/claims/CLM-0001', await t.login(U.priya)));
    assert.equal(auto.history[1].actor, 'system');
  });

  it('TEST-AC-08-2 FR-08 AC-08.2 unauthorised user gets 403 or 404 and anonymous gets 401', async () => {
    assert.equal((await t.call('GET', '/api/claims/CLM-0011', await t.login(U.vikram))).statusCode, 403);
    assert.equal((await t.call('GET', '/api/claims/CLM-0011', await t.login(U.rahul))).statusCode, 403);
    assert.equal((await t.call('GET', '/api/claims/CLM-0011')).statusCode, 401);
  });

  it('TEST-AC-13-1 FR-13 AC-13.1 manager views the receipt of a queued claim; owner and Finance too', async () => {
    const res = await t.call('GET', `/api/claims/${receiptClaim}/receipt`, await t.login(U.priya));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.deepEqual(res.rawPayload, PNG);
    assert.equal((await t.call('GET', `/api/claims/${receiptClaim}/receipt`, await t.login(U.amit))).statusCode, 200);
    assert.equal((await t.call('GET', `/api/claims/${receiptClaim}/receipt`, await t.login(U.anita))).statusCode, 200);
    const none = await t.call('GET', '/api/claims/CLM-0011/receipt', await t.login(U.priya));
    assert.equal(none.statusCode, 404);
  });

  it('TEST-AC-13-2 FR-13 AC-13.2 NFR-05 non-report manager and other employees get 403 FORBIDDEN', async () => {
    const res = await t.call('GET', `/api/claims/${receiptClaim}/receipt`, await t.login(U.rahul));
    assert.equal(res.statusCode, 403);
    assert.equal(json(res).error.code, 'FORBIDDEN');
    assert.equal((await t.call('GET', `/api/claims/${receiptClaim}/receipt`, await t.login(U.neha))).statusCode, 403);
  });
});

describe('reports, export, seed, health (FR-09..FR-12)', () => {
  let t: TestApp, f: TestApp;
  before(async () => { t = await makeApp(); f = await makeApp(); });
  after(async () => { await t.app.close(); await f.app.close(); rmSync(t.dir, { recursive: true, force: true }); rmSync(f.dir, { recursive: true, force: true }); });

  it('TEST-AC-09-1 FR-09 AC-09.1 finance monthly report', async () => {
    const res = await t.call('GET', '/api/reports/monthly?month=2026-09', await t.login(U.anita));
    assert.equal(res.statusCode, 200);
    const r = json(res);
    assert.equal(r.month, '2026-09');
    assert.equal(r.grandTotal, '12350.50');
    assert.equal(r.approvedCount, 3);
    assert.deepEqual(r.statusCounts, { Submitted: 0, Approved: 3, Rejected: 1 });
    assert.equal(r.byCategory.length, 6);
    assert.deepEqual(r.byCategory.find((c: { category: string }) => c.category === 'Lodging'), { category: 'Lodging', total: '7800.00', count: 1 });
    assert.deepEqual(r.byEmployee.map((e: { employeeEmail: string; total: string }) => [e.employeeEmail, e.total]), [[U.amit, '4550.50'], [U.neha, '7800.00']]);
    assert.equal((await t.call('GET', '/api/reports/monthly?month=bad', await t.login(U.anita))).statusCode, 422);
    assert.equal((await t.call('GET', '/api/reports/monthly', await t.login(U.anita))).statusCode, 422);
  });

  it('TEST-AC-09-2 FR-09 AC-09.2 non-finance gets 403 FORBIDDEN', async () => {
    for (const email of [U.amit, U.priya]) {
      const res = await t.call('GET', '/api/reports/monthly?month=2026-09', await t.login(email));
      assert.equal(res.statusCode, 403);
      assert.equal(json(res).error.code, 'FORBIDDEN');
      assert.equal((await t.call('GET', '/api/reports/monthly.csv?month=2026-09', await t.login(email))).statusCode, 403);
    }
  });

  it('TEST-AC-10-1 FR-10 AC-10.1 CSV export has the specified columns and UTF-8', async () => {
    const res = await t.call('GET', '/api/reports/monthly.csv?month=2026-10', await t.login(U.anita));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
    const lines = res.body.trim().split('\r\n');
    assert.equal(lines[0], 'claim_id,employee_email,employee_name,date,category,amount,description,approved_by,approved_at');
    assert.equal(lines.length, 5);
    assert.match(lines.find((l) => l.startsWith('CLM-0007')) ?? '', /चाय और नाश्ता - client meeting,system,/);
    assert.match(lines.find((l) => l.startsWith('CLM-0008')) ?? '', /"Taxi to airport, return trip",rahul\.mehta@spendwise\.example,/);
    assert.equal((await t.call('GET', '/api/reports/monthly.csv?month=x', await t.login(U.anita))).statusCode, 422);
  });

  it('TEST-AC-10-2 FR-10 AC-10.2 formula-like cells are prefixed with a quote', async () => {
    const c = await t.login(U.amit);
    for (const [i, text] of ['=HYPERLINK("http://x")', '+cmd', '-cmd', '@SUM(1)'].entries()) {
      const res = await t.call('POST', '/api/claims', c, claim({ date: `2026-08-0${i + 1}`, amount: '300.00', description: text }));
      assert.equal(res.statusCode, 201);
    }
    const csv = (await t.call('GET', '/api/reports/monthly.csv?month=2026-08', await t.login(U.anita))).body;
    assert.ok(csv.includes("\"'=HYPERLINK(\"\"http://x\"\")\""));
    assert.match(csv, /,'\+cmd,/);
    assert.match(csv, /,'-cmd,/);
    assert.match(csv, /,'@SUM\(1\),/);
  });

  it('TEST-AC-11-1 FR-11 AC-11.1 BR-11 seed data is loaded with given IDs and one manager per user', async () => {
    const res = json(await f.call('GET', '/api/claims', await f.login(U.anita)));
    assert.equal(res.total, 14);
    const ids = new Set(res.items.map((c: { id: string }) => c.id));
    assert.ok(ids.has('CLM-0014'));
    const me = json(await f.call('GET', '/api/me', await f.login(U.amit)));
    assert.ok(me.managerId);
    assert.equal(json(await f.call('GET', '/api/me', await f.login(U.sanjay))).managerId, null);
  });

  it('TEST-AC-11-2 FR-11 AC-11.2 seeding twice adds no duplicates', async () => {
    const { seedDemoData } = await import('../src/seed.js');
    const { buildApp } = await import('../src/app.js');
    const { openDb } = await import('../src/db.js');
    const db = openDb(':memory:');
    await seedDemoData(db, new URL('../../seed', import.meta.url).pathname);
    const count = () => ({
      users: (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n,
      claims: (db.prepare('SELECT COUNT(*) n FROM claims').get() as { n: number }).n,
      events: (db.prepare('SELECT COUNT(*) n FROM claim_events').get() as { n: number }).n,
    });
    const first = count();
    await seedDemoData(db, new URL('../../seed', import.meta.url).pathname);
    assert.deepEqual(count(), first);
    assert.equal(first.claims, 14);
    const app = await buildApp({ dataDir: t.dir, db, seed: true });
    assert.deepEqual(count(), first);
    await app.close();
  });

  it('TEST-AC-11-3 FR-11 AC-11.3 new claims continue the CLM-nnnn sequence', async () => {
    const res = await f.call('POST', '/api/claims', await f.login(U.sneha), claim({ date: '2026-05-05' }));
    assert.equal(json(res).id, 'CLM-0015');
    const next = await f.call('POST', '/api/claims', await f.login(U.sneha), claim({ date: '2026-05-06' }));
    assert.equal(json(next).id, 'CLM-0016');
  });

  it('TEST-AC-12-1 FR-12 AC-12.1 health returns ok and semver version', async () => {
    const res = await t.call('GET', '/api/health');
    assert.equal(res.statusCode, 200);
    assert.match(json(res).version, /^\d+\.\d+\.\d+$/);
    assert.equal(json(res).status, 'ok');
  });

  it('TEST-NFR-08 NFR-08 Unicode text round-trips through claims and the CSV', async () => {
    const text = 'होटल 🏨 Zoë';
    const created = await t.call('POST', '/api/claims', await t.login(U.arjun), claim({ date: '2026-07-07', amount: '250.00', description: text }));
    assert.equal(json(created).description, text);
    const csv = (await t.call('GET', '/api/reports/monthly.csv?month=2026-07', await t.login(U.anita))).body;
    assert.ok(csv.includes(text));
  });
});

describe('security (NFR-04, NFR-05)', () => {
  let t: TestApp;
  const logs: string[] = [];
  before(async () => {
    const stream = { write: (line: string) => { logs.push(line); } };
    t = await makeApp({ logger: { level: 'info', stream, redact: ['req.headers.cookie'] } as never });
  });
  after(async () => { await t.app.close(); rmSync(t.dir, { recursive: true, force: true }); });

  it('TEST-NFR-04 NFR-04 security headers are set and X-Powered-By is absent', async () => {
    const res = await t.call('GET', '/');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.match(String(res.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.match(String(res.headers['content-security-policy']), /default-src 'self'/);
    assert.equal((await t.call('GET', '/app.js')).statusCode, 200);
    assert.equal((await t.call('GET', '/styles.css')).statusCode, 200);
  });

  it('TEST-NFR-04 NFR-04 state-changing requests with a foreign Origin are rejected', async () => {
    const cookie = await t.login(U.amit);
    const bad = await t.call('POST', '/api/claims', cookie, claim({ date: '2026-06-01' }), { origin: 'https://evil.example', host: 'app.example' });
    assert.equal(bad.statusCode, 403);
    assert.equal(JSON.parse(bad.body).error.code, 'FORBIDDEN');
    const nullOrigin = await t.call('POST', '/api/auth/logout', cookie, undefined, { origin: 'null' });
    assert.equal(nullOrigin.statusCode, 403);
    const same = await t.call('POST', '/api/claims', cookie, claim({ date: '2026-06-01' }), { origin: 'https://app.example', host: 'app.example' });
    assert.equal(same.statusCode, 201);
    const get = await t.call('GET', '/api/me', cookie, undefined, { origin: 'https://evil.example' });
    assert.equal(get.statusCode, 200);
  });

  it('TEST-NFR-04 NFR-04 every protected endpoint requires a session', async () => {
    const routes: [string, string][] = [
      ['GET', '/api/me'], ['GET', '/api/claims'], ['POST', '/api/claims'], ['GET', '/api/claims/CLM-0001'],
      ['PATCH', '/api/claims/CLM-0001'], ['DELETE', '/api/claims/CLM-0001'], ['GET', '/api/claims/CLM-0001/receipt'],
      ['GET', '/api/team/claims'], ['POST', '/api/claims/CLM-0001/approve'], ['POST', '/api/claims/CLM-0001/reject'],
      ['GET', '/api/reports/monthly?month=2026-09'], ['GET', '/api/reports/monthly.csv?month=2026-09'],
    ];
    for (const [method, url] of routes) {
      const res = await t.call(method, url);
      assert.equal(res.statusCode, 401, `${method} ${url}`);
    }
  });

  it('TEST-NFR-04 NFR-04 bodies over 5 MB and malformed JSON fail without stack traces', async () => {
    const cookie = await t.login(U.amit);
    const big = await t.call('POST', '/api/claims', cookie, JSON.stringify({ description: 'x'.repeat(5.5 * 1024 * 1024) }), { 'content-type': 'application/json' });
    assert.equal(big.statusCode, 413);
    const bad = await t.call('POST', '/api/claims', cookie, '{oops', { 'content-type': 'application/json' });
    assert.equal(bad.statusCode, 400);
    assert.doesNotMatch(bad.body + big.body, /stack|node_modules|\.ts:|\.js:/);
    const missing = await t.call('GET', '/api/nothing');
    assert.equal(missing.statusCode, 404);
    assert.equal(JSON.parse(missing.body).error.code, 'NOT_FOUND');
  });

  it('TEST-NFR-04 NFR-04 receipts are stored under server-generated names', async () => {
    const { readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const m = multipart(claim({ date: '2026-06-10', amount: '2500.00' }), { name: 'my receipt.pdf', data: PDF, type: 'application/pdf' });
    await t.call('POST', '/api/claims', await t.login(U.amit), m.payload, m.headers);
    const files = readdirSync(join(t.dir, 'receipts'));
    assert.ok(files.length > 0);
    assert.ok(files.every((f) => /^[0-9a-f-]{36}\.(pdf|png|jpg)$/.test(f)));
  });

  it('TEST-NFR-05 NFR-05 logs contain no passwords, cookies or receipt contents; request id is present', async () => {
    const secret = 'SuperSecret-Password-123';
    await t.call('POST', '/api/auth/login', undefined, { email: U.amit, password: secret });
    const cookie = await t.login(U.amit);
    await t.call('GET', '/api/me', cookie);
    const text = logs.join('\n');
    assert.ok(text.includes('reqId'));
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes(PASSWORD));
    assert.ok(!text.includes(cookie.split('=')[1]));
  });
});

describe('security rate limit (NFR-04)', () => {
  it('TEST-NFR-04 NFR-04 more than 10 failed logins per minute per IP are rejected with 429', async () => {
    const t = await makeApp();
    try {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) {
        const r = await t.call('POST', '/api/auth/login', undefined, { email: `ghost${i}@x.example`, password: 'bad' });
        codes.push(r.statusCode);
      }
      assert.deepEqual(codes.slice(0, 10), Array(10).fill(401));
      assert.deepEqual(codes.slice(10), [429, 429]);
      t.clock.time += 61_000;
      const again = await t.call('POST', '/api/auth/login', undefined, { email: U.amit, password: PASSWORD });
      assert.equal(again.statusCode, 200);
    } finally {
      await t.app.close();
      rmSync(t.dir, { recursive: true, force: true });
    }
  });
});
