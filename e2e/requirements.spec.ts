import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const PASSWORD = 'Spend@Test2026';

async function login(request: APIRequestContext, email: string) {
  const res = await request.post('/api/auth/login', { data: { email, password: PASSWORD } });
  expect(res.status()).toBe(200);
}

test('TEST-AC-12-1 FR-12 health returns ok and semver', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
  expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
});

test('TEST-AC-01-2 FR-01 wrong password gives 401 INVALID_CREDENTIALS', async ({ request }) => {
  const res = await request.post('/api/auth/login', { data: { email: 'sneha.iyer@spendwise.example', password: 'wrong' } });
  expect(res.status()).toBe(401);
  expect((await res.json()).error.code).toBe('INVALID_CREDENTIALS');
});

test('TEST-AC-11-1 FR-11 seeded claims keep their IDs', async ({ request }) => {
  await login(request, 'anita.desai@spendwise.example');
  const res = await request.get('/api/claims?month=2026-09');
  const body = await res.json();
  expect(body.items.map((c: { id: string }) => c.id)).toContain('CLM-0001');
});

test('TEST-AC-03-1 TEST-AC-04-1 TEST-AC-07-2 submit, duplicate warning, and manager approval flow', async ({ playwright }) => {
  const employee = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4100' });
  await login(employee, 'arjun.rao@spendwise.example');
  const small = await employee.post('/api/claims', { data: { date: '2026-11-19', category: 'Meals', amount: '500.00', description: 'Team snacks' } });
  expect(small.status()).toBe(201);
  expect(await small.json()).toMatchObject({ status: 'Approved', decidedBy: 'system' });
  const dup = await employee.post('/api/claims', { data: { date: '2026-11-19', category: 'Meals', amount: '500.00', description: 'Team snacks' } });
  expect(dup.status()).toBe(409);
  expect((await dup.json()).error.code).toBe('DUPLICATE_CLAIM');

  const big = await employee.post('/api/claims', { data: { date: '2026-11-19', category: 'Travel', amount: '1500.00', description: 'Airport transfer' } });
  expect(big.status()).toBe(201);
  const { id } = await big.json();

  const manager = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4100' });
  await login(manager, 'priya.nair@spendwise.example');
  const queue = await (await manager.get('/api/team/claims?status=Submitted')).json();
  expect(queue.items.map((c: { id: string }) => c.id)).toContain(id);
  const approved = await manager.post(`/api/claims/${id}/approve`);
  expect(approved.status()).toBe(200);
  expect((await approved.json()).status).toBe('Approved');
  const locked = await employee.delete(`/api/claims/${id}`);
  expect(locked.status()).toBe(409);
});

test('TEST-AC-09-1 TEST-AC-10-1 finance report and CSV export', async ({ request }) => {
  await login(request, 'anita.desai@spendwise.example');
  const report = await (await request.get('/api/reports/monthly?month=2026-09')).json();
  expect(report.grandTotal).toBe('12350.50');
  const csv = await request.get('/api/reports/monthly.csv?month=2026-09');
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('claim_id,employee_email,employee_name,date,category,amount,description,approved_by,approved_at');
});

test('TEST-AC-09-2 TEST-NFR-04 non-finance is forbidden from reports', async ({ request }) => {
  await login(request, 'amit.sharma@spendwise.example');
  expect((await request.get('/api/reports/monthly?month=2026-09')).status()).toBe(403);
});

test('TEST-NFR-04 security headers and foreign Origin rejection', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  expect(res.headers()['x-powered-by']).toBeUndefined();
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  const forged = await request.post('/api/auth/login', {
    data: { email: 'amit.sharma@spendwise.example', password: PASSWORD },
    headers: { origin: 'https://evil.example' },
  });
  expect(forged.status()).toBe(403);
});

test('TEST-AC-01-1 UI login and claim list', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('neha.kapoor@spendwise.example');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'My claims' })).toBeVisible();
  await expect(page.getByText('CLM-0003')).toBeVisible();
});
