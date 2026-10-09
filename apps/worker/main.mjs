import pg from 'pg';
import dotenv from 'dotenv';
import { runWorker } from '../../scripts/worker/runtime.mjs';

dotenv.config({ path: '.env.local', quiet: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort());
try {
  await runWorker(pool, { signal: controller.signal });
} catch (error) {
  console.error(
    'Vanly worker startup:',
    /^([A-Z_]+)$/.test(error.code || '') ? error.code : 'WORKER_STARTUP_FAILED',
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
