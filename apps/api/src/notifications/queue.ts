import type { Pool, PoolClient } from 'pg';

export type NotificationDb = Pool | PoolClient;
export type MailOptions = {
  eventKey?: string;
  template?: string;
  variables?: Record<string, string | number>;
  expiresAt?: string;
  documentRefs?: { documentId: string }[];
  notificationGuard?: Record<string, string | number>;
  marketing?: { campaignId: string; unsubscribeUrl: string; oneClickUnsubscribeUrl: string };
  senderKind?: 'no-reply' | 'portal';
};

// Only enqueue here. Rendering, retries and external I/O belong to the mailer worker.
// Pass the active transaction client so a notification cannot outlive a rolled-back change.
export async function enqueueMail(
  db: NotificationDb,
  userId: string,
  subject: string,
  body: string,
  options: MailOptions = {},
) {
  if (!subject.trim() || subject.length > 200 || /[\r\n]/.test(subject))
    throw new Error('Nieprawidłowy temat powiadomienia.');
  if (!body.trim() || body.length > 20000) throw new Error('Nieprawidłowa treść powiadomienia.');
  if (options.eventKey && options.eventKey.length > 240)
    throw new Error('Nieprawidłowy identyfikator zdarzenia.');
  if (options.expiresAt && !Number.isFinite(Date.parse(options.expiresAt)))
    throw new Error('Nieprawidłowy termin powiadomienia.');
  const payload = { userId, subject, body, ...options };
  // The event key is an indexed queue field, never a secret-bearing template variable.
  delete payload.eventKey;
  const result = await db.query(
    `INSERT INTO jobs(kind,payload,recipient_user_id,event_key)
     VALUES('mail',$1,$2,$3)
     ON CONFLICT(recipient_user_id,event_key)
       WHERE kind='mail' AND event_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [JSON.stringify(payload), userId, options.eventKey ?? null],
  );
  return result.rows[0]?.id ?? null;
}
