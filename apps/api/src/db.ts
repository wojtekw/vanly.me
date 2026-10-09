import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { notifyBookingExpired } from './notifications/booking-events';
export { enqueueMail as mail } from './notifications/queue';
types.setTypeParser(1082, (s: string) => s);
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12 });
export const q = async <T extends QueryResultRow = any>(
  text: string,
  values: any[] = [],
  db: Pool | PoolClient = pool,
) => (await db.query<T>(text, values)).rows;
export async function tx<T>(fn: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const r = await fn(db);
    await db.query('COMMIT');
    return r;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    db.release();
  }
}
export async function audit(
  db: Pool | PoolClient,
  user: any,
  action: string,
  resource: string,
  details: any = {},
) {
  await db.query(
    'INSERT INTO audit(user_id,company_id,action,resource,details) VALUES($1,$2,$3,$4,$5)',
    [user?.id || null, user?.company_id || null, action, resource, JSON.stringify(details)],
  );
}
export async function expireHolds(db: Pool | PoolClient = pool) {
  if (db instanceof Pool) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await expireHolds(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return;
  }
  const expired = await db.query<{ id: string; reference: string; user_id: string; created_at: Date }>(
    `UPDATE bookings SET status='expired',updated_at=now()
     WHERE status='held' AND hold_until<=now() RETURNING id,reference,user_id,created_at`,
  );
  if (!expired.rows.length) return;
  await db.query('UPDATE allocations SET active=false WHERE booking_id=ANY($1::uuid[])', [expired.rows.map(booking => booking.id)]);
  for (const booking of expired.rows) await notifyBookingExpired(db, booking);
}
