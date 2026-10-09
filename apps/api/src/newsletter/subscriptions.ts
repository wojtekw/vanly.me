import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { NotificationDb, enqueueMail } from '../notifications/queue';
import { notificationUrl } from '../notifications/format';
export const NEWSLETTER_CONSENT_VERSION = 'vanly-inspiracje-email-v1-2026-10-07';
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function updateNewsletterPreference(
  db: NotificationDb,
  account: { id: string; name: string },
  wants: boolean,
  origin?: string,
) {
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [account.id]);
  const existing = (
    await db.query('SELECT * FROM newsletter_subscriptions WHERE user_id=$1 FOR UPDATE', [
      account.id,
    ])
  ).rows[0];
  if (!wants) {
    if (existing) await withdrawNewsletter(db, account.id);
    return 'unsubscribed';
  }
  if (existing?.status === 'confirmed') return 'confirmed';
  const recentRequest = await db.query(
    `SELECT 1 FROM newsletter_tokens WHERE user_id=$1 AND kind='confirm'
    AND created_at>now()-interval '5 minutes' LIMIT 1`,
    [account.id],
  );
  if (recentRequest.rowCount) return existing?.status || 'pending';
  if (
    existing?.status === 'pending' &&
    new Date(existing.requested_at).getTime() > Date.now() - 5 * 60_000
  )
    return 'pending';
  await db.query(
    `INSERT INTO newsletter_subscriptions(user_id,status,consent_version,origin)
    VALUES($1,'pending',$2,$3) ON CONFLICT(user_id) DO UPDATE SET status='pending',consent_version=$2,
    requested_at=now(),confirmed_at=NULL,unsubscribed_at=NULL,origin=$3`,
    [account.id, NEWSLETTER_CONSENT_VERSION, new URL(notificationUrl('/', origin)).origin],
  );
  await db.query(
    "UPDATE newsletter_tokens SET used_at=now() WHERE user_id=$1 AND kind='confirm' AND used_at IS NULL",
    [account.id],
  );
  const token = randomBytes(32).toString('hex');
  const hash = tokenHash(token);
  const expires = (
    await db.query(
      `INSERT INTO newsletter_tokens(token_hash,user_id,kind,expires_at)
    VALUES($1,$2,'confirm',now()+interval '24 hours') RETURNING expires_at`,
      [hash, account.id],
    )
  ).rows[0].expires_at;
  const url = notificationUrl('/newsletter/potwierdz?token=' + token, origin);
  const subject = 'VANLY — potwierdź zapis na inspiracje';
  const intro = 'Otrzymaliśmy Twoją prośbę o zapis na e-maile z inspiracjami VANLY.';
  const details =
    'Potwierdź zapis, aby otrzymywać poradniki i pomysły na wyjazdy. Link jest ważny przez 24 godziny.';
  const next =
    'Jeśli nie chcesz tych wiadomości albo nie wysyłasz tej prośby, pomiń e-mail. Nie wpływa to na powiadomienia o koncie i rezerwacjach.';
  await enqueueMail(db, account.id, subject, [intro, details, next, url].join('\n\n'), {
    eventKey: 'newsletter.confirm_requested:' + hash,
    expiresAt: new Date(expires).toISOString(),
    template: '00-bazowy-transakcyjny',
    variables: {
      first_name: account.name.split(' ')[0],
      email_subject: subject,
      email_preheader: intro,
      email_heading: 'Potwierdź zapis na inspiracje',
      message_category: 'TWÓJ WYBÓR',
      intro_text: intro,
      details_text: details,
      next_step_text: next,
      cta_label: 'Potwierdź zapis',
      action_url: url,
    },
    senderKind: 'no-reply',
    notificationGuard: { kind: 'newsletter-confirm', tokenHash: hash },
  });
  return 'pending';
}
export async function confirmNewsletter(db: NotificationDb, token: string) {
  const candidate = (
    await db.query("SELECT user_id FROM newsletter_tokens WHERE token_hash=$1 AND kind='confirm'", [
      tokenHash(token),
    ])
  ).rows[0];
  if (!candidate) throw new BadRequestException('Link wygasł albo został wykorzystany.');
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [candidate.user_id]);
  const row = (
    await db.query(
      `SELECT user_id FROM newsletter_tokens WHERE token_hash=$1 AND kind='confirm'
    AND used_at IS NULL AND expires_at>now() FOR UPDATE`,
      [tokenHash(token)],
    )
  ).rows[0];
  if (!row) throw new BadRequestException('Link wygasł albo został wykorzystany.');
  const updated = await db.query(
    `UPDATE newsletter_subscriptions SET status='confirmed',confirmed_at=now(),unsubscribed_at=NULL
    WHERE user_id=$1 AND status='pending' RETURNING user_id`,
    [row.user_id],
  );
  if (!updated.rowCount) throw new BadRequestException('Ta prośba o zapis nie jest już aktualna.');
  await db.query(
    "UPDATE newsletter_tokens SET used_at=now() WHERE user_id=$1 AND kind='confirm' AND used_at IS NULL",
    [row.user_id],
  );
  await db.query(
    `UPDATE users SET profile=jsonb_set(profile,'{marketing}','true'::jsonb) WHERE id=$1`,
    [row.user_id],
  );
  return { ok: true, message: 'Zapis na inspiracje VANLY został potwierdzony.' };
}
export async function withdrawNewsletter(db: NotificationDb, userId: string) {
  await db.query(
    "UPDATE newsletter_subscriptions SET status='unsubscribed',unsubscribed_at=COALESCE(unsubscribed_at,now()) WHERE user_id=$1",
    [userId],
  );
  await db.query(
    "UPDATE newsletter_tokens SET used_at=now() WHERE user_id=$1 AND kind='confirm' AND used_at IS NULL",
    [userId],
  );
  await db.query(
    `UPDATE users SET profile=jsonb_set(profile,'{marketing}','false'::jsonb) WHERE id=$1`,
    [userId],
  );
}
export async function unsubscribeNewsletter(db: NotificationDb, token: string) {
  const row = (
    await db.query(
      "SELECT user_id FROM newsletter_tokens WHERE token_hash=$1 AND kind='unsubscribe'",
      [tokenHash(token)],
    )
  ).rows[0];
  if (!row) throw new BadRequestException('Nieprawidłowy link rezygnacji.');
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [row.user_id]);
  await withdrawNewsletter(db, row.user_id);
  // Unsubscribe links remain valid: retrying RFC8058 is safe and never resubscribes.
  return {
    ok: true,
    message:
      'Zrezygnowano z inspiracji VANLY. Powiadomienia o koncie i rezerwacjach pozostają aktywne.',
  };
}
