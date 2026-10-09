import { createLocalProvider } from '../../packages/mailer/providers/local.mjs';
import { createSesProvider } from '../../packages/mailer/providers/ses.mjs';
import { assertTestDeliveryConfig } from '../../packages/mailer/delivery-routing.mjs';
import { MailerError } from '../../packages/mailer/errors.mjs';

// Keep each tester's private inbox available while exercising SES with its
// existing single-recipient test permission. This module is UAT-only.
export function createUatTestMailProvider(pool, config, providers = {}) {
  assertTestDeliveryConfig(config);
  if (!config.testMode || config.provider !== 'ses')
    throw new MailerError('UAT_TEST_MAIL_CONFIGURATION_REQUIRED');
  const local = providers.local || createLocalProvider(pool);
  const ses = providers.ses || createSesProvider(config);
  return {
    name: 'ses',
    async send(message, job) {
      // MailerService already routed this delivery to the one test recipient.
      // The original recipient_user_id continues to scope the private inbox.
      if (job.email !== config.testRecipient)
        throw new MailerError('UAT_TEST_MAIL_RECIPIENT_MISMATCH');
      try { await local.send(message, job); }
      catch { throw new MailerError('LOCAL_MAIL_STORAGE_FAILED', 'retry'); }
      return ses.send(message, job);
    },
    close() { local.close?.(); ses.close?.(); },
  };
}
