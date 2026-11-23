import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppOptions } from '../src/app.js';

export const PASSWORD = 'Spend@Test2026';
export const U = {
  sanjay: 'sanjay.gupta@spendwise.example',
  priya: 'priya.nair@spendwise.example',
  rahul: 'rahul.mehta@spendwise.example',
  anita: 'anita.desai@spendwise.example',
  amit: 'amit.sharma@spendwise.example',
  neha: 'neha.kapoor@spendwise.example',
  arjun: 'arjun.rao@spendwise.example',
  vikram: 'vikram.singh@spendwise.example',
  sneha: 'sneha.iyer@spendwise.example',
};

export interface TestApp {
  app: FastifyInstance;
  clock: { time: number };
  dir: string;
  login: (email: string) => Promise<string>;
  call: (method: string, url: string, cookie?: string, payload?: unknown, headers?: Record<string, string>) => Promise<LightMyRequestResponse>;
}

export async function makeApp(extra: Partial<AppOptions> = {}): Promise<TestApp> {
  const dir = (mkdirSync('.test-data', { recursive: true }), mkdtempSync(join('.test-data', 'spendwise-')));
  const clock = { time: Date.parse('2026-11-23T06:30:00Z') };
  const app = await buildApp({ dataDir: dir, seed: true, now: () => new Date(clock.time), ...extra });
  const cookies = new Map<string, string>();
  const login = async (email: string) => {
    const cached = cookies.get(email);
    if (cached) return cached;
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: PASSWORD } });
    if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.statusCode}`);
    const cookie = String(res.headers['set-cookie']).split(';')[0];
    cookies.set(email, cookie);
    return cookie;
  };
  const call: TestApp['call'] = (method, url, cookie, payload, headers = {}) =>
    app.inject({
      method: method as 'GET',
      url,
      headers: { ...(cookie ? { cookie } : {}), ...headers },
      payload: payload as string | object | undefined,
    });
  return { app, clock, dir, login, call };
}

export function multipart(fields: Record<string, string>, file?: { name: string; data: Buffer; type: string }) {
  const boundary = `----spendwise${Date.now()}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="receipt"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
export const PDF = Buffer.from('%PDF-1.4\n%fake\n');

export const claim = (over: Record<string, unknown> = {}) => ({
  date: '2026-11-20',
  category: 'Travel',
  amount: '750.00',
  description: 'Client visit taxi',
  ...over,
});

export const fieldCodes = (body: string): string[] =>
  (JSON.parse(body) as { error: { fields?: { code: string }[] } }).error.fields?.map((f) => f.code) ?? [];
