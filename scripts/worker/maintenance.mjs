export async function maintainPortal(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Hold expiry belongs to expireHoldsWithNotifications: status, allocation and
    // outbox must commit together. A second expiry path here could lose notices
    // for a hold that elapsed between the two worker steps.
    await client.query('DELETE FROM sessions WHERE expires_at<now()');
    await client.query(
      `UPDATE jobs SET status='failed',attempts=attempts+1,
         error='UNSUPPORTED_JOB_KIND',finished_at=now()
       WHERE status='pending' AND kind<>'mail' AND next_run<=now()`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
