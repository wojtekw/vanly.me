import pg from 'pg';
import { loadMailerConfig } from '../../packages/mailer/index.mjs';
import { runWorker } from '../../scripts/worker/runtime.mjs';
import { createUatTestMailProvider } from './test-mail-provider.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
try {
  const config = loadMailerConfig();
  const provider = config.provider === 'ses' ? createUatTestMailProvider(pool, config) : undefined;
  await runWorker(pool, { signal: controller.signal, mailerOptions: provider ? { provider } : {} });
} catch (error) {
  console.error('Vanly UAT worker:', /^([A-Z_]+)$/.test(error.code || '') ? error.code : 'WORKER_STARTUP_FAILED');
  process.exitCode = 1;
} finally {
  await pool.end();
}
