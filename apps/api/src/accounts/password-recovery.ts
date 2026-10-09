import crypto from 'node:crypto';
import { tx } from '../db';
import { notifyPasswordReset } from '../notifications/account';

// Lock the account so simultaneous requests share the same five-minute cooldown.
// The controller returns the same response when the account is absent or limited.
export async function requestPasswordReset(email: string, origin?: string): Promise<void> {
  await tx(async (db) => {
    const { rows: [account] } = await db.query(
      'SELECT id,name FROM users WHERE email=$1 FOR UPDATE', [email],
    );
    if (!account) return;
    const recent = await db.query(
      "SELECT 1 FROM reset_tokens WHERE user_id=$1 AND created_at>now()-interval '5 minutes' LIMIT 1",
      [account.id],
    );
    if (recent.rowCount) return;
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows: [reset] } = await db.query(
      "INSERT INTO reset_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes') RETURNING expires_at",
      [tokenHash, account.id],
    );
    await notifyPasswordReset(db, account, {
      token, tokenHash, expiresAt: new Date(reset.expires_at).toISOString(), origin,
    });
  });
}
