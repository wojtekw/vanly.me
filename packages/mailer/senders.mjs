import { MailerError } from './errors.mjs';

// Jobs select a purpose; only deployment configuration supplies sender addresses.
export function getMailSender(config, kind = 'portal') {
  if (kind === 'no-reply') return { from: config.noReplyFrom || config.from, replyTo: null };
  if (kind === 'portal') return { from: config.portalFrom || config.from, replyTo: config.replyTo };
  throw new MailerError('INVALID_MAIL_SENDER_KIND');
}
