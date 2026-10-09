import { createHash, randomBytes } from 'node:crypto';
import { loadNotificationConfig } from './config.mjs';
import { transaction, enqueueEvent, genericNotice } from './repository.mjs';
const hash = (value) => createHash('sha256').update(value).digest('hex');

export class NewsletterProducer {
  constructor(pool, { config = loadNotificationConfig(), now = () => new Date() } = {}) {
    this.pool = pool;
    this.config = config;
    this.now = now;
  }
  async tick() {
    if (!this.config.newsletterEnabled) return { queued: 0 };
    const now = this.now();
    return transaction(this.pool, async (db) => {
      const campaigns = (
        await db.query(
          `SELECT c.*,a.title,a.summary FROM newsletter_campaigns c JOIN articles a ON a.id=c.article_id
        WHERE c.status='ready' AND c.approved_at IS NOT NULL AND c.created_at >= $1 AND a.published=true
        ORDER BY c.approved_at LIMIT 5 FOR UPDATE OF c SKIP LOCKED`,
          [this.config.startAfter],
        )
      ).rows;
      let queued = 0;
      for (const campaign of campaigns) {
        const recipients = (
          await db.query(
            `SELECT u.id,u.email,s.confirmed_at FROM newsletter_subscriptions s JOIN users u ON u.id=s.user_id
          WHERE s.status='confirmed' AND s.confirmed_at<=$2
            AND NOT EXISTS(SELECT 1 FROM newsletter_campaign_recipients r WHERE r.campaign_id=$1 AND r.user_id=u.id)
          ORDER BY u.id LIMIT $3 FOR UPDATE OF u`,
            [campaign.id, campaign.approved_at, this.config.batchSize],
          )
        ).rows;
        for (const recipient of recipients) {
          const stillConfirmed = await db.query(
            "SELECT 1 FROM newsletter_subscriptions WHERE user_id=$1 AND status='confirmed'",
            [recipient.id],
          );
          if (!stillConfirmed.rowCount) continue;
          const suppressed = await db.query(
            'SELECT 1 FROM mail_suppressions WHERE address_hash=$1',
            [hash(recipient.email.trim().toLowerCase())],
          );
          await db.query(
            'INSERT INTO newsletter_campaign_recipients(campaign_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
            [campaign.id, recipient.id],
          );
          if (suppressed.rowCount) continue;
          const token = randomBytes(32).toString('hex');
          await db.query(
            "INSERT INTO newsletter_tokens(token_hash,user_id,kind) VALUES($1,$2,'unsubscribe')",
            [hash(token), recipient.id],
          );
          const unsubscribeUrl = new URL(
            '/newsletter/rezygnacja?token=' + token,
            this.config.appUrl,
          ).href;
          const oneClickUnsubscribeUrl = new URL(
            '/api/v1/newsletter/one-click?token=' + token,
            this.config.appUrl,
          ).href;
          const actionUrl = new URL(
            '/artykul/' + encodeURIComponent(campaign.article_id),
            this.config.appUrl,
          ).href;
          const intro = `Nowy materiał VANLY: ${campaign.title}`;
          const next = `Otrzymujesz tę wiadomość po potwierdzeniu zapisu na inspiracje VANLY. Możesz zrezygnować w każdej chwili: ${unsubscribeUrl}`;
          const jobId = await enqueueEvent(
            db,
            recipient.id,
            `newsletter.campaign:${campaign.id}`,
            genericNotice(campaign.subject, intro, campaign.summary, next, actionUrl, {
              category: 'INSPIRACJE VANLY',
              expiresAt: new Date(now.getTime() + 72 * 3600_000).toISOString(),
              marketing: { campaignId: campaign.id, unsubscribeUrl, oneClickUnsubscribeUrl },
              notificationGuard: { kind: 'newsletter', campaignId: campaign.id },
            }),
            now,
          );
          if (jobId) {
            await db.query(
              'UPDATE newsletter_campaign_recipients SET job_id=$3 WHERE campaign_id=$1 AND user_id=$2',
              [campaign.id, recipient.id, jobId],
            );
            queued++;
          }
        }
        const left = await db.query(
          `SELECT 1 FROM newsletter_subscriptions s
          WHERE s.status='confirmed' AND s.confirmed_at<=$2
            AND NOT EXISTS(SELECT 1 FROM newsletter_campaign_recipients r WHERE r.campaign_id=$1 AND r.user_id=s.user_id) LIMIT 1`,
          [campaign.id, campaign.approved_at],
        );
        if (!left.rowCount)
          await db.query("UPDATE newsletter_campaigns SET status='completed' WHERE id=$1", [
            campaign.id,
          ]);
      }
      return { queued };
    });
  }
}
