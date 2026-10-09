import { randomUUID } from 'node:crypto';
import { MailerError } from './errors.mjs';

export class MailQueue {
  constructor(pool, config) {
    this.pool = pool;
    this.config = config;
  }

  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recoverLeases(client) {
    const expired = await client.query(
      `UPDATE jobs SET
        status=CASE WHEN provider='ses' THEN 'unknown' WHEN attempts >= $1 THEN 'dead' ELSE 'pending' END,
        error=CASE WHEN provider='ses' THEN 'SES_LEASE_EXPIRED_ACCEPTANCE_UNKNOWN' ELSE 'LOCAL_LEASE_EXPIRED' END,
        finished_at=CASE WHEN provider='ses' OR attempts >= $1 THEN now() ELSE NULL END,
        next_run=now(),lease_token=NULL,lease_until=NULL
       WHERE kind='mail' AND status='processing' AND lease_until<=now()
       RETURNING id,attempts,status,error`,
      [this.config.maxAttempts],
    );
    for (const job of expired.rows)
      await client.query(
        `UPDATE mail_deliveries SET status=$3,error_code=$4,finished_at=now()
         WHERE job_id=$1 AND attempt=$2 AND status='processing'`,
        [job.id, job.attempts, job.status === 'pending' ? 'retry' : job.status, job.error],
      );
    await client.query(
      `UPDATE jobs SET status='dead',error='ATTEMPT_LIMIT_REACHED',finished_at=now()
       WHERE kind='mail' AND status='pending' AND attempts >= $1`,
      [this.config.maxAttempts],
    );
  }

  async claim() {
    return this.transaction(async (client) => {
      await this.recoverLeases(client);
      const selected = await client.query(
        `SELECT j.*,u.email,u.name FROM jobs j LEFT JOIN users u ON u.id=j.recipient_user_id
         WHERE j.kind='mail' AND j.status='pending' AND j.next_run<=now()
           AND j.attempts<$1 AND (j.provider IS NULL OR j.provider=$2)
           AND ($3::timestamptz IS NULL OR j.created_at >= $3::timestamptz)
         ORDER BY j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1`,
        [this.config.maxAttempts, this.config.provider, this.config.startAfter],
      );
      const job = selected.rows[0];
      if (!job) return null;
      const leaseToken = randomUUID();
      const updated = await client.query(
        `UPDATE jobs SET status='processing',attempts=attempts+1,provider=$2,
          lease_token=$3,lease_until=now()+($4*interval '1 second'),error=NULL
         WHERE id=$1 RETURNING attempts,lease_token`,
        [job.id, this.config.provider, leaseToken, this.config.leaseSeconds],
      );
      Object.assign(job, updated.rows[0], { provider: this.config.provider });
      await client.query(
        `INSERT INTO mail_deliveries(job_id,recipient_user_id,attempt,provider,status)
         VALUES($1,$2,$3,$4,'processing')`,
        [job.id, job.recipient_user_id, job.attempts, job.provider],
      );
      return job;
    });
  }

  async finish(job, outcome) {
    return this.transaction(async (client) => {
      const lock = await client.query(
        `SELECT id FROM jobs WHERE id=$1 AND lease_token=$2 AND status='processing' FOR UPDATE`,
        [job.id, job.lease_token],
      );
      if (!lock.rowCount) throw new MailerError('MAIL_LEASE_LOST', 'unknown');
      const success = ['local', 'accepted'].includes(outcome.status);
      const status = success ? 'done' : outcome.status === 'retry' ? 'pending' : outcome.status;
      await client.query(
        `UPDATE mail_deliveries SET status=$3,provider_message_id=$4,error_code=$5,finished_at=now()
         WHERE job_id=$1 AND attempt=$2`,
        [job.id, job.attempts, outcome.status, outcome.messageId || null, outcome.code || null],
      );
      await client.query(
        `UPDATE jobs SET status=$3,error=$4,lease_token=NULL,lease_until=NULL,
          finished_at=CASE WHEN $3='pending' THEN NULL ELSE now() END,
          next_run=now()+($5*interval '1 second'),
          payload=CASE WHEN $6 THEN jsonb_strip_nulls(jsonb_build_object(
            'userId',recipient_user_id,'template',payload->>'template','redacted',true)) ELSE payload END
         WHERE id=$1 AND lease_token=$2`,
        [job.id, job.lease_token, status, outcome.code || null, outcome.delaySeconds || 0, success],
      );
    });
  }

  async prepareSend(job) {
    // Content preparation may wait on document/status queries. Never start a
    // provider request from a lease that has expired or been recovered elsewhere.
    const lease = await this.pool.query(
      `UPDATE jobs SET lease_until=now()+($3*interval '1 second')
       WHERE id=$1 AND lease_token=$2 AND status='processing' AND lease_until>now()
       RETURNING id`,
      [job.id, job.lease_token, this.config.leaseSeconds],
    );
    if (!lease.rowCount) throw new MailerError('MAIL_LEASE_LOST', 'unknown');
  }

  async scrubFinishedPayloads() {
    await this.pool.query(
      `UPDATE jobs SET payload=jsonb_strip_nulls(jsonb_build_object(
         'userId',recipient_user_id,'template',payload->>'template','redacted',true))
       WHERE kind='mail' AND status IN ('done','dead','unknown','failed')
         AND COALESCE(finished_at,created_at)<now()-($1*interval '1 hour')
         AND payload->>'redacted' IS DISTINCT FROM 'true'`,
      [this.config.retentionHours],
    );
  }
}
