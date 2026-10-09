import { validateAddress } from './config.mjs';
import { MailerError } from './errors.mjs';

export const TEST_SUBJECT_PREFIX = 'VANLY-TEST: ';

export function assertTestDeliveryConfig(config) {
  if (config.testMode !== undefined && typeof config.testMode !== 'boolean')
    throw new MailerError('INVALID_MAIL_TEST_MODE');
  if (!config.testMode) {
    if (config.testRecipient) throw new MailerError('MAIL_TEST_RECIPIENT_REQUIRES_TEST_MODE');
    return;
  }
  if (config.deploymentEnvironment !== 'local')
    throw new MailerError('MAIL_TEST_MODE_REQUIRES_LOCAL_ENVIRONMENT');
  if (!validateAddress(config.testRecipient)) throw new MailerError('INVALID_MAIL_TEST_RECIPIENT');
  if (config.provider === 'ses') {
    if (!config.awsProfile) throw new MailerError('MAIL_TEST_SES_PROFILE_REQUIRED');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.awsProfile))
      throw new MailerError('INVALID_MAIL_TEST_SES_PROFILE');
  }
}

export function getDeliveryRecipient(config, job) {
  assertTestDeliveryConfig(config);
  return config.testMode ? config.testRecipient : job.email;
}

// Business checks, rendering, document authorization and queue completion always
// use the original job. Only the provider-facing delivery copy is redirected.
export function routeMailDelivery(config, message, job) {
  assertTestDeliveryConfig(config);
  if (!config.testMode) return { message, job };
  if (typeof message.subject !== 'string' || /[\r\n]/.test(message.subject))
    throw new MailerError('INVALID_EMAIL_SUBJECT');
  const subject = message.subject.startsWith(TEST_SUBJECT_PREFIX)
    ? message.subject
    : TEST_SUBJECT_PREFIX + message.subject;
  return Object.freeze({
    message: Object.freeze({ ...message, subject }),
    job: Object.freeze({ ...job, email: getDeliveryRecipient(config, job) }),
  });
}
