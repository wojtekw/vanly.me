import { localDay, calendarDate, distanceDays } from './config.mjs';
// Worker injection keeps business status queries out of the generic transport package.
export async function validateNotificationGuard(pool, job, { now = new Date() } = {}) {
  const g = job.payload?.notificationGuard;
  if (!g) return true;
  if (typeof g !== 'object' || Array.isArray(g)) return false;
  const today = localDay(now);
  if (['email-verification', 'password-reset', 'newsletter-confirm'].includes(g.kind)) {
    if (!/^[a-f0-9]{64}$/.test(g.tokenHash || '')) return false;
    const statements = {
      'email-verification': `SELECT 1 FROM email_verification_tokens t JOIN users u ON u.id=t.user_id
        WHERE t.user_id=$1 AND t.token_hash=$2 AND t.used_at IS NULL AND t.expires_at>$3
          AND u.email_verified_at IS NULL`,
      'password-reset': `SELECT 1 FROM reset_tokens
        WHERE user_id=$1 AND token_hash=$2 AND used_at IS NULL AND expires_at>$3`,
      'newsletter-confirm': `SELECT 1 FROM newsletter_tokens t JOIN newsletter_subscriptions s ON s.user_id=t.user_id
        WHERE t.user_id=$1 AND t.token_hash=$2 AND t.kind='confirm' AND t.used_at IS NULL AND t.expires_at>$3
          AND s.status='pending'`,
    };
    return (
      (await pool.query(statements[g.kind], [job.recipient_user_id, g.tokenHash, now])).rowCount > 0
    );
  }
  if (g.kind === 'newsletter') {
    const result = await pool.query(
      `SELECT 1 FROM newsletter_subscriptions s JOIN newsletter_campaigns c ON c.id=$2
      JOIN articles a ON a.id=c.article_id WHERE s.user_id=$1 AND s.status='confirmed'
      AND s.confirmed_at<=c.approved_at AND c.status IN('ready','completed') AND a.published=true`,
      [job.recipient_user_id, g.campaignId],
    );
    return result.rowCount > 0;
  }
  if (g.kind === 'unread') {
    const result = await pool.query(
      `SELECT 1 FROM messages m JOIN vehicles v ON v.id=m.vehicle_id JOIN users u ON u.id=$1
      LEFT JOIN message_reads r ON r.vehicle_id=m.vehicle_id AND r.traveler_id=m.traveler_id AND r.user_id=u.id
      WHERE m.id=$2 AND m.vehicle_id=$3 AND m.traveler_id=$4 AND m.author_id!=u.id
        AND (r.read_through IS NULL OR r.read_through<m.created_at)
        AND (u.id=m.traveler_id OR (u.role='owner' AND u.company_id=v.company_id))`,
      [job.recipient_user_id, g.messageId, g.vehicleId, g.travelerId],
    );
    return result.rowCount > 0;
  }
  if (!['balance', 'pickup', 'return', 'review'].includes(g.kind)) return false;
  const b = (
    await pool.query(
      `SELECT b.*,
    EXISTS(SELECT 1 FROM comments r WHERE r.booking_id=b.id AND r.author_id=b.user_id AND r.type='review') AS reviewed
    FROM bookings b WHERE b.id=$1 AND b.user_id=$2`,
      [g.bookingId, job.recipient_user_id],
    )
  ).rows[0];
  if (!b) return false;
  const start =
    typeof b.start_date === 'string' ? b.start_date.slice(0, 10) : localDay(b.start_date);
  const end = typeof b.end_date === 'string' ? b.end_date.slice(0, 10) : localDay(b.end_date);
  if (g.kind === 'balance')
    return (
      b.status === 'confirmed' &&
      b.snapshot?.settlementMode !== 'direct' &&
      ['partial', 'unpaid'].includes(b.payment_status) &&
      b.total_minor > b.paid_minor &&
      calendarDate(b.snapshot?.balanceDue) === g.dueDate &&
      b.total_minor === g.totalMinor &&
      b.paid_minor === g.paidMinor &&
      distanceDays(today, g.dueDate) === g.days
    );
  if (g.kind === 'pickup')
    return b.status === 'confirmed' && start === g.date && distanceDays(today, start) === 1;
  if (g.kind === 'return')
    return b.status === 'in_rental' && end === g.date && distanceDays(today, end) === 1;
  return b.status === 'completed' && !b.reviewed && g.date === today;
}
