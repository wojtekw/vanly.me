import { attachmentMetadata, validateAttachments, validateEncodedMessageSize } from '../attachments.mjs';

export function createLocalProvider(pool) {
  return {
    name: 'local',
    async send(message, job) {
      const attachments = validateAttachments(message.attachments);
      validateEncodedMessageSize({ ...message, attachments });
      // Unique job_id makes recovery after a lost DB response safe in local mode.
      const result = await pool.query(
        `INSERT INTO local_mail(user_id,subject,body,html,text_body,template_id,job_id,attachments)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(job_id) WHERE job_id IS NOT NULL
         DO UPDATE SET job_id=EXCLUDED.job_id RETURNING id`,
        [
          job.recipient_user_id,
          message.subject,
          message.legacyBody,
          message.html,
          message.text,
          message.templateId,
          job.id,
          JSON.stringify(attachmentMetadata(attachments)),
        ],
      );
      return { messageId: `local:${result.rows[0].id}`, status: 'local' };
    },
    close() {},
  };
}
