import { MailerError } from '../errors.mjs';

const priority = {
  delayed: 10,
  soft_bounce: 70,
  delivered: 50,
  rendering_failed: 80,
  rejected: 80,
  hard_bounce: 90,
  complaint: 100,
};
const storedPriority = `CASE feedback_status WHEN 'delayed' THEN 10 WHEN 'soft_bounce' THEN 70
  WHEN 'delivered' THEN 50 WHEN 'rendering_failed' THEN 80 WHEN 'rejected' THEN 80
  WHEN 'hard_bounce' THEN 90 WHEN 'complaint' THEN 100 ELSE 0 END`;

export class FeedbackRepository {
  constructor(pool) {
    this.pool = pool;
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

  async link(client, feedback) {
    const delivery = (
      await client.query(
        `SELECT id FROM mail_deliveries WHERE provider='ses' AND provider_message_id=$1
       ORDER BY id LIMIT 1 FOR UPDATE`,
        [feedback.provider_message_id],
      )
    ).rows[0];
    if (!delivery) return false;
    await client.query(
      `UPDATE mail_deliveries SET feedback_status=$2,feedback_at=$3
       WHERE id=$1 AND (${storedPriority} < $4 OR
         (${storedPriority} = $4 AND (feedback_at IS NULL OR feedback_at <= $3::timestamptz)))`,
      [
        delivery.id,
        feedback.feedback_status,
        feedback.occurred_at,
        priority[feedback.feedback_status],
      ],
    );
    await client.query('UPDATE mail_feedback SET delivery_id=$2 WHERE id=$1', [
      feedback.id,
      delivery.id,
    ]);
    return true;
  }

  async record(event) {
    return this.transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO mail_feedback(topic_arn,sns_message_id,sqs_message_id,provider_message_id,
          event_type,feedback_status,occurred_at,recipient_hashes,candidate_job_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING *`,
        [
          event.topicArn,
          event.snsMessageId,
          event.sqsMessageId,
          event.providerMessageId,
          event.eventType,
          event.status,
          event.occurredAt,
          event.recipientHashes,
          event.candidateJobId,
        ],
      );
      const feedback = inserted.rows[0];
      if (!feedback) return { duplicate: true };
      if (['hard_bounce', 'complaint'].includes(event.status))
        for (const hash of event.recipientHashes)
          await client.query(
            `INSERT INTO mail_suppressions(address_hash,reason,feedback_id) VALUES($1,$2,$3)
             ON CONFLICT(address_hash) DO UPDATE SET
               reason=CASE WHEN mail_suppressions.reason='complaint' THEN 'complaint' ELSE EXCLUDED.reason END,
               feedback_id=CASE WHEN mail_suppressions.reason='complaint' AND EXCLUDED.reason<>'complaint'
                 THEN mail_suppressions.feedback_id ELSE EXCLUDED.feedback_id END,updated_at=now()`,
            [hash, event.status, feedback.id],
          );
      return { duplicate: false, linked: await this.link(client, feedback) };
    });
  }

  async reconcileKnown(limit = 100) {
    const events = (
      await this.pool.query(
        `SELECT f.id FROM mail_feedback f WHERE f.delivery_id IS NULL AND EXISTS(
         SELECT 1 FROM mail_deliveries d WHERE d.provider='ses' AND d.provider_message_id=f.provider_message_id)
       ORDER BY f.id LIMIT $1`,
        [limit],
      )
    ).rows;
    for (const item of events)
      await this.transaction(async (client) => {
        const feedback = (
          await client.query(
            'SELECT * FROM mail_feedback WHERE id=$1 AND delivery_id IS NULL FOR UPDATE',
            [item.id],
          )
        ).rows[0];
        if (feedback) await this.link(client, feedback);
      });
    return events.length;
  }

  // Explicit operator action only; no HTTP API or automatic resend. The trusted
  // SES vanly_job tag must identify the exact unknown job being reconciled.
  async reconcileUnknown(feedbackId, jobId) {
    return this.transaction(async (client) => {
      const feedback = (
        await client.query('SELECT * FROM mail_feedback WHERE id=$1 FOR UPDATE', [feedbackId])
      ).rows[0];
      if (!feedback || String(feedback.candidate_job_id) !== String(jobId))
        throw new MailerError('FEEDBACK_JOB_TAG_MISMATCH');
      const job = (
        await client.query(
          "SELECT * FROM jobs WHERE id=$1 AND status='unknown' AND provider='ses' FOR UPDATE",
          [jobId],
        )
      ).rows[0];
      if (!job) throw new MailerError('FEEDBACK_JOB_NOT_UNKNOWN');
      const delivery = (
        await client.query(
          `SELECT * FROM mail_deliveries WHERE job_id=$1 AND attempt=$2 AND provider='ses'
         AND status='unknown' AND provider_message_id IS NULL FOR UPDATE`,
          [jobId, job.attempts],
        )
      ).rows[0];
      if (!delivery) throw new MailerError('FEEDBACK_UNKNOWN_ATTEMPT_UNAVAILABLE');
      const collision = await client.query(
        "SELECT 1 FROM mail_deliveries WHERE provider='ses' AND provider_message_id=$1",
        [feedback.provider_message_id],
      );
      if (collision.rowCount) throw new MailerError('FEEDBACK_MESSAGE_ALREADY_ASSIGNED');
      await client.query(
        "UPDATE mail_deliveries SET status='accepted',provider_message_id=$2,error_code='SES_FEEDBACK_RECONCILED' WHERE id=$1",
        [delivery.id, feedback.provider_message_id],
      );
      await this.link(client, feedback);
      await client.query(
        `UPDATE jobs SET status='done',error='SES_FEEDBACK_RECONCILED',finished_at=now(),
           payload=jsonb_strip_nulls(jsonb_build_object('userId',recipient_user_id,'template',payload->>'template','redacted',true))
         WHERE id=$1`,
        [jobId],
      );
      return { jobId, deliveryId: delivery.id, providerMessageId: feedback.provider_message_id };
    });
  }
}
