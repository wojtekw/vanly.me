import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { enqueueMail, NotificationDb } from '../notifications/queue';
import { notificationUrl, notifyStatus } from '../notifications/format';
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// Call under the user's row lock / registration transaction. Resending invalidates
// earlier links and does not reveal tokens outside the queued private message.
export async function requestEmailVerification(
  db: NotificationDb,
  account: { id: string; name: string },
  origin?: string,
) {
  const current = await db.query('SELECT email_verified_at FROM users WHERE id=$1 FOR UPDATE', [
    account.id,
  ]);
  if (current.rows[0]?.email_verified_at) return;
  const recent = await db.query(
    `SELECT 1 FROM email_verification_tokens WHERE user_id=$1
    AND created_at>now()-interval '5 minutes' LIMIT 1`,
    [account.id],
  );
  if (recent.rowCount) return;
  await db.query(
    'UPDATE email_verification_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
    [account.id],
  );
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const saved = await db.query(
    `INSERT INTO email_verification_tokens(token_hash,user_id,expires_at)
    VALUES($1,$2,now()+interval '24 hours') RETURNING expires_at`,
    [tokenHash, account.id],
  );
  const expiresAt = new Date(saved.rows[0].expires_at).toISOString();
  const actionUrl = notificationUrl('/potwierdz-email?token=' + token, origin);
  await enqueueMail(
    db,
    account.id,
    'VANLY — potwierdź swój adres e-mail',
    `Potwierdź adres e-mail swojego konta VANLY. Link jest ważny przez 24 godziny.\n\n${actionUrl}\n\nJeśli nie zakładasz konta, pomiń tę wiadomość.`,
    {
      eventKey: 'account.email_verification:' + tokenHash,
      template: '01-weryfikacja-adresu',
      expiresAt,
      senderKind: 'no-reply',
      notificationGuard: { kind: 'email-verification', tokenHash },
      variables: {
        first_name: account.name.split(' ')[0],
        action_url: actionUrl,
        verification_expires_at: new Intl.DateTimeFormat('pl-PL', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Europe/Warsaw',
        }).format(new Date(expiresAt)),
      },
    },
  );
}

export async function verifyEmail(db: NotificationDb, token: string) {
  const tokenHash = hashToken(token);
  const candidate = await db.query(
    'SELECT user_id FROM email_verification_tokens WHERE token_hash=$1',
    [tokenHash],
  );
  if (!candidate.rowCount) throw new BadRequestException('Link wygasł albo został wykorzystany.');
  await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [candidate.rows[0].user_id]);
  const current = await db.query(
    `SELECT user_id FROM email_verification_tokens
    WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE`,
    [tokenHash],
  );
  if (!current.rowCount) throw new BadRequestException('Link wygasł albo został wykorzystany.');
  const id = current.rows[0].user_id;
  await db.query(
    'UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1',
    [id],
  );
  await db.query(
    'UPDATE email_verification_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
    [id],
  );
  await notifyStatus(db, {
    userId: id,
    eventKey: 'account.email_verified:' + tokenHash,
    subject: 'Adres e-mail w VANLY został potwierdzony',
    category: 'TWOJE KONTO',
    intro: 'Twój adres e-mail został potwierdzony.',
    details: 'Powiadomienia o koncie i rezerwacjach będą trafiać na ten adres.',
    nextStep: 'Swoje rezerwacje i wiadomości znajdziesz na koncie.',
    cta: 'Otwórz konto',
    path: '/konto',
    senderKind: 'no-reply',
  });
  return { ok: true, message: 'Twój adres e-mail został potwierdzony.' };
}
