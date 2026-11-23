import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approveClaim, receiptFor, rejectClaim, teamClaims } from './approvals.js';
import { AuthService } from './auth.js';
import { createClaim, deleteClaim, getClaim, listClaims, updateClaim } from './claims.js';
import type { ClaimPayload, Ctx } from './claims.js';
import { openDb } from './db.js';
import type { Db } from './db.js';
import { AppError, forbidden, notFound } from './errors.js';
import type { User } from './policy.js';
import { monthlyCsv, monthlyReport } from './reports.js';
import { MAX_RECEIPT_BYTES } from './receipts.js';
import { seedDemoData } from './seed.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export interface AppOptions {
  dataDir: string;
  dbPath?: string;
  seed?: boolean;
  now?: () => Date;
  db?: Db;
  logger?: FastifyServerOptions['logger'];
  version?: string;
}

const STATIC_FILES: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};

const SESSION_COOKIE = 'sid';

function readVersion(): string {
  return (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

const isSecure = (request: FastifyRequest) =>
  request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https';

function sessionCookie(request: FastifyRequest, value: string, clear = false): string {
  return [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(clear ? ['Max-Age=0'] : []),
    ...(isSecure(request) ? ['Secure'] : []),
  ].join('; ');
}

async function readPayload(request: FastifyRequest): Promise<ClaimPayload> {
  if (request.isMultipart()) {
    const fields: Record<string, unknown> = {};
    let upload: ClaimPayload['upload'];
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const data = await part.toBuffer();
        if (part.fieldname === 'receipt' && data.length > 0) upload = { data, truncated: part.file.truncated };
      } else {
        fields[part.fieldname] = part.value;
      }
    }
    return { fields, upload };
  }
  const body = request.body;
  if (body === undefined || body === null) return { fields: {} };
  if (typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'BAD_REQUEST', 'Invalid request body.');
  return { fields: body as Record<string, unknown> };
}

export async function buildApp(options: AppOptions) {
  const now = options.now ?? (() => new Date());
  const db = options.db ?? openDb(options.dbPath ?? join(options.dataDir, 'spendwise.db'));
  const ctx: Ctx = { db, receiptsDir: join(options.dataDir, 'receipts'), now };
  const auth = new AuthService(db, () => now().getTime());
  const version = options.version ?? readVersion();

  if (options.seed) await seedDemoData(db, join(ROOT, 'seed'));

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 5 * 1024 * 1024,
    genReqId: () => randomUUID(),
    trustProxy: process.env.TRUST_PROXY === 'true',
  });
  await app.register(multipart, {
    throwFileSizeLimit: false,
    limits: { fileSize: MAX_RECEIPT_BYTES, files: 2, fields: 12, fieldSize: 4096, parts: 16 },
  });

  const staticFiles = new Map(
    Object.entries(STATIC_FILES).map(([url, [file, type]]) => [url, { body: readFileSync(join(ROOT, 'public', file)), type }]),
  );

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    const origin = request.headers.origin;
    if (origin !== undefined && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      let host = '';
      try {
        host = new URL(origin).host;
      } catch {
        host = '';
      }
      if (host !== request.headers.host) throw forbidden();
    }
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header(
      'content-security-policy',
      "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cross-origin-resource-policy', 'same-origin');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('cache-control', 'no-store');
    reply.removeHeader('x-powered-by');
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({
        error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) },
      });
    }
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      const code = status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'BAD_REQUEST';
      return reply.status(status).send({ error: { code, message: status === 413 ? 'Request is too large.' : 'Invalid request.' } });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } }));

  const currentUser = (request: FastifyRequest): User =>
    auth.resolve(cookieValue(request.headers.cookie, SESSION_COOKIE));

  const health = async () => ({ status: 'ok', version });
  app.get('/api/health', health);
  app.get('/health', health);

  for (const [url, file] of staticFiles) {
    app.get(url, async (_request, reply) => reply.header('content-type', file.type).send(file.body));
  }

  app.post('/api/auth/login', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const { user, token } = await auth.login(body.email, body.password, request.ip);
    reply.header('set-cookie', sessionCookie(request, token));
    return user;
  });

  app.post('/api/auth/logout', async (request, reply) => {
    auth.logout(cookieValue(request.headers.cookie, SESSION_COOKIE));
    reply.header('set-cookie', sessionCookie(request, '', true));
    return reply.status(204).send();
  });

  app.get('/api/me', async (request) => currentUser(request));

  app.get('/api/claims', async (request) =>
    listClaims(ctx, currentUser(request), request.query as Record<string, string | undefined>),
  );

  app.post('/api/claims', async (request, reply) => {
    const user = currentUser(request);
    return reply.status(201).send(createClaim(ctx, user, await readPayload(request)));
  });

  type IdParams = { Params: { id: string } };

  app.get<IdParams>('/api/claims/:id', async (request) => getClaim(ctx, currentUser(request), request.params.id));

  app.patch<IdParams>('/api/claims/:id', async (request) => {
    const user = currentUser(request);
    return updateClaim(ctx, user, request.params.id, await readPayload(request));
  });

  app.delete<IdParams>('/api/claims/:id', async (request, reply) => {
    deleteClaim(ctx, currentUser(request), request.params.id);
    return reply.status(204).send();
  });

  app.get<IdParams>('/api/claims/:id/receipt', async (request, reply: FastifyReply) => {
    const { path, mime } = receiptFor(ctx, currentUser(request), request.params.id);
    let data: Buffer;
    try {
      data = readFileSync(path);
    } catch {
      throw notFound();
    }
    return reply.header('content-type', mime).header('content-disposition', 'inline').send(data);
  });

  app.get('/api/team/claims', async (request) =>
    teamClaims(ctx, currentUser(request), (request.query as { status?: string }).status),
  );

  app.post<IdParams>('/api/claims/:id/approve', async (request) =>
    approveClaim(ctx, currentUser(request), request.params.id),
  );

  app.post<IdParams>('/api/claims/:id/reject', async (request) =>
    rejectClaim(ctx, currentUser(request), request.params.id, ((request.body ?? {}) as { comment?: unknown }).comment),
  );

  const requireFinance = (request: FastifyRequest) => {
    if (currentUser(request).role !== 'Finance') throw forbidden();
  };

  app.get('/api/reports/monthly', async (request) => {
    requireFinance(request);
    return monthlyReport(ctx, (request.query as { month?: unknown }).month);
  });

  app.get('/api/reports/monthly.csv', async (request, reply) => {
    requireFinance(request);
    const month = (request.query as { month?: unknown }).month;
    const csv = monthlyCsv(ctx, month);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="spendwise-${String(month)}.csv"`)
      .send(csv);
  });

  return app;
}
