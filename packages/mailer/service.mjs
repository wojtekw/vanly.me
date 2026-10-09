import { loadMailerConfig, validateAddress } from './config.mjs';
import { MailerError, deliveryFailure } from './errors.mjs';
import { MailQueue } from './queue.mjs';
import { renderMail } from './renderer.mjs';
import { createLocalProvider } from './providers/local.mjs';
import { createSesProvider } from './providers/ses.mjs';
import { SuppressionList } from './feedback/suppression.mjs';
import { assertTestDeliveryConfig, getDeliveryRecipient, routeMailDelivery } from './delivery-routing.mjs';

export function retryDelay(attempt, config, random = Math.random) {
  const base = Math.min(3600, config.retryBaseSeconds * 2 ** (attempt - 1));
  return Math.min(3600, base + Math.floor(base * 0.1 * random()));
}

export class MailerService {
  constructor(pool, options = {}) {
    this.config = options.config || loadMailerConfig();
    assertTestDeliveryConfig(this.config);
    this.queue = options.queue || new MailQueue(pool, this.config);
    this.provider =
      options.provider ||
      (this.config.provider === 'ses'
        ? createSesProvider(this.config, options.sesClient)
        : createLocalProvider(pool));
    if (this.provider.name !== this.config.provider)
      throw new MailerError('MAIL_PROVIDER_CONFIG_MISMATCH');
    this.random = options.random || Math.random;
    this.suppression = options.suppression || new SuppressionList(pool);
    this.documentResolver = options.documentResolver;
    this.notificationGuard = options.notificationGuard;
  }

  assertNotExpired(job) {
    if (!job.payload?.expiresAt) return;
    const expiresAt = Date.parse(job.payload.expiresAt);
    if (!Number.isFinite(expiresAt)) throw new MailerError('INVALID_MAIL_EXPIRY');
    if (expiresAt <= Date.now()) throw new MailerError('MAIL_EXPIRED');
  }

  async process(job) {
    let message;
    let delivery;
    try {
      if (
        !job.recipient_user_id ||
        !validateAddress(job.email) ||
        job.payload?.userId !== job.recipient_user_id
      )
        throw new MailerError('MAIL_RECIPIENT_UNAVAILABLE');
      this.assertNotExpired(job);
      let attachments = [];
      if (job.payload.documentRefs) {
        if (!this.documentResolver) throw new MailerError('MAIL_DOCUMENT_RESOLVER_UNAVAILABLE');
        try { attachments = await this.documentResolver(job.payload.documentRefs, job); }
        catch (error) {
          if (error?.name === 'DocumentError') throw new MailerError(error.code);
          throw new MailerError('MAIL_DOCUMENT_LOAD_FAILED', 'retry');
        }
      }
      message = renderMail(job.payload, this.config, job, new Date(), attachments);
      if (this.config.provider === 'ses') {
        let suppressed;
        try {
          suppressed = await this.suppression.isSuppressed(getDeliveryRecipient(this.config, job));
        } catch {
          throw new MailerError('MAIL_SUPPRESSION_CHECK_FAILED', 'retry');
        }
        if (suppressed) throw new MailerError('MAIL_RECIPIENT_SUPPRESSED');
      }
      // Resolution can wait on the DB. Check mutable business state only after
      // preparing the content, as close as possible to the actual provider call.
      if (job.payload.notificationGuard || job.payload.marketing) {
        if (!job.payload.notificationGuard || !this.notificationGuard)
          throw new MailerError('NOTIFICATION_GUARD_UNAVAILABLE');
        let applicable;
        try { applicable = await this.notificationGuard(job); }
        catch { throw new MailerError('NOTIFICATION_GUARD_CHECK_FAILED', 'retry'); }
        if (!applicable) throw new MailerError('NOTIFICATION_NO_LONGER_APPLICABLE');
      }
      try { await this.queue.prepareSend?.(job); }
      catch (error) {
        if (error instanceof MailerError && error.code === 'MAIL_LEASE_LOST') throw error;
        throw new MailerError('MAIL_LEASE_CHECK_FAILED', 'retry');
      }
      this.assertNotExpired(job);
      delivery = routeMailDelivery(this.config, message, job);
    } catch (error) {
      // A stale worker must leave the recovered attempt untouched. Recovery
      // decides unknown/retry from the provider; this worker cannot send or finish.
      if (error instanceof MailerError && error.code === 'MAIL_LEASE_LOST') throw error;
      const status =
        error instanceof MailerError &&
        error.outcome === 'retry' &&
        job.attempts < this.config.maxAttempts
          ? 'retry'
          : 'dead';
      await this.queue.finish(job, {
        status,
        code: error instanceof MailerError ? error.code : 'MAIL_RENDER_FAILED',
        delaySeconds: status === 'retry' ? retryDelay(job.attempts, this.config, this.random) : 0,
      });
      return status;
    }
    let outcome;
    try {
      // Claim transaction is committed before calling AWS or the local provider.
      outcome = await this.provider.send(delivery.message, delivery.job);
    } catch (error) {
      const failure =
        this.config.provider === 'local'
          ? new MailerError('LOCAL_MAIL_STORAGE_FAILED', 'retry')
          : deliveryFailure(error);
      const status =
        failure.outcome === 'retry' && job.attempts >= this.config.maxAttempts
          ? 'dead'
          : failure.outcome;
      await this.queue.finish(job, {
        status,
        code: failure.code,
        delaySeconds: status === 'retry' ? retryDelay(job.attempts, this.config, this.random) : 0,
      });
      return status;
    }
    // A database error after provider acceptance must not trigger another send.
    // Keep the lease; SES lease recovery will put the job in unknown for review.
    await this.queue.finish(job, outcome);
    return outcome.status;
  }

  async tick() {
    const results = [];
    for (let i = 0; i < this.config.batchSize; i++) {
      // Claim one at a time so queued items don't lose their lease behind slow sends.
      const job = await this.queue.claim();
      if (!job) break;
      results.push({ jobId: job.id, status: await this.process(job) });
    }
    await this.queue.scrubFinishedPayloads();
    return results;
  }

  close() {
    this.provider.close?.();
  }
}
