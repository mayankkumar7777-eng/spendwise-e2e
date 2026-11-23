import { resolve } from 'node:path';
import { buildApp } from './app.js';

const app = await buildApp({
  dataDir: resolve(process.env.DATA_DIR ?? 'data'),
  seed: process.env.SEED_DEMO_DATA === 'true',
  logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
});

// Bind all interfaces by default so a published container/preview port is reachable.
await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '0.0.0.0' });
