import { setTimeout as sleep } from 'node:timers/promises';
import { MailerService, loadMailerConfig } from '../../packages/mailer/index.mjs';
import { maintainPortal } from './maintenance.mjs';
import { FeedbackService } from '../../packages/mailer/feedback/service.mjs';
import { resolveMailDocuments } from '../../packages/documents/service.mjs';
import { loadNotificationConfig } from './reminders/config.mjs';
import { ReminderProducer, expireHoldsWithNotifications } from './reminders/producer.mjs';
import { NewsletterProducer } from './reminders/newsletter.mjs';
import { validateNotificationGuard } from './reminders/guard.mjs';

export async function runWorker(pool, { signal, env = process.env, logger = console, mailerOptions = {} } = {}) {
  const config = loadMailerConfig(env);
  const notificationConfig = loadNotificationConfig(env);
  const mailer = new MailerService(pool, {
    ...mailerOptions,
    config,
    documentResolver: (refs, job) => resolveMailDocuments(pool, refs, job),
    notificationGuard: (job) => validateNotificationGuard(pool, job),
  });
  const reminders = new ReminderProducer(pool, { config: notificationConfig });
  const newsletter = new NewsletterProducer(pool, { config: notificationConfig });
  const feedback = config.feedbackEnabled ? new FeedbackService(pool, config) : null;
  logger.log(`Vanly worker: mail provider=${config.provider}.`);
  try {
    while (!signal?.aborted) {
      try {
        await expireHoldsWithNotifications(pool, { config: notificationConfig });
        await maintainPortal(pool);
        await reminders.tick();
        await newsletter.tick();
        if (feedback) {
          try {
            const result = await feedback.tick();
            if (result.invalid)
              logger.error('Vanly feedback: UNTRUSTED_OR_INVALID_FEEDBACK (awaiting SQS redrive).');
            if (result.received >= config.feedbackBatchSize) {
              await sleep(config.pollMs, undefined, { signal }).catch(() => {});
              continue; // Drain feedback backlog before sending another SES batch.
            }
          } catch {
            // Fail closed for configured feedback outages: don't keep sending
            // while new complaint/bounce suppressions cannot reach the database.
            logger.error('Vanly feedback: FEEDBACK_UNAVAILABLE; SES batch deferred.');
            await sleep(config.pollMs, undefined, { signal }).catch(() => {});
            continue;
          }
        }
        const processed = await mailer.tick();
        if (processed.length) logger.log('Vanly mail batch:', processed);
      } catch {
        // Never log raw errors, payloads, credentials, e-mail addresses or reset URLs.
        logger.error('Vanly worker: WORKER_TICK_FAILED (check queue/history and database health).');
      }
      try {
        await sleep(config.pollMs, undefined, { signal });
      } catch (error) {
        if (error.name !== 'AbortError') throw error;
      }
    }
  } finally {
    mailer.close();
    feedback?.close();
  }
}
