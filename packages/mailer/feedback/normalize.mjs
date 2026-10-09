import { createHash } from 'node:crypto';
import { validateAddress } from '../config.mjs';
import { MailerError } from '../errors.mjs';

export function addressHash(address) {
  const normalized = typeof address === 'string' ? address.trim().toLowerCase() : '';
  if (!validateAddress(normalized)) throw new MailerError('INVALID_FEEDBACK_RECIPIENT');
  return createHash('sha256').update(normalized).digest('hex');
}

export function normalizeFeedback(message, config) {
  if (
    typeof message.Body !== 'string' ||
    Buffer.byteLength(message.Body) > 262144 ||
    !/^[A-Za-z0-9-]{1,128}$/.test(message.MessageId || '')
  )
    throw new MailerError('INVALID_FEEDBACK_MESSAGE');
  let envelope, event;
  try {
    envelope = JSON.parse(message.Body);
  } catch {
    throw new MailerError('INVALID_FEEDBACK_ENVELOPE');
  }
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    envelope.Type !== 'Notification' ||
    envelope.TopicArn !== config.feedbackTopicArn ||
    !/^[A-Za-z0-9-]{1,128}$/.test(envelope.MessageId || '') ||
    typeof envelope.Message !== 'string'
  )
    throw new MailerError('UNTRUSTED_FEEDBACK_ENVELOPE');
  // Transport is authenticated SQS with a SNS-only queue policy. Never fetch
  // SigningCertURL, SubscribeURL or arbitrary URLs from the message.
  try {
    event = JSON.parse(envelope.Message);
  } catch {
    throw new MailerError('INVALID_SES_FEEDBACK');
  }
  if (!event || typeof event !== 'object') throw new MailerError('INVALID_SES_FEEDBACK');
  const type = event.eventType || event.notificationType;
  if (typeof type !== 'string') throw new MailerError('UNSUPPORTED_SES_FEEDBACK_EVENT');
  const eventType = type.replace(/\s+/g, '');
  const mapping = {
    Delivery: ['delivered', 'delivery'],
    Bounce: [event.bounce?.bounceType === 'Permanent' ? 'hard_bounce' : 'soft_bounce', 'bounce'],
    Complaint: ['complaint', 'complaint'],
    Reject: ['rejected', 'reject'],
    RenderingFailure: ['rendering_failed', 'failure'],
    DeliveryDelay: ['delayed', 'deliveryDelay'],
  };
  if (!mapping[eventType]) throw new MailerError('UNSUPPORTED_SES_FEEDBACK_EVENT');
  const [status, detailKey] = mapping[eventType];
  const messageId = event.mail?.messageId;
  if (typeof messageId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(messageId))
    throw new MailerError('INVALID_SES_FEEDBACK_MESSAGE_ID');
  const date = event[detailKey]?.timestamp || envelope.Timestamp || event.mail?.timestamp;
  if (typeof date !== 'string' || !Number.isFinite(Date.parse(date)))
    throw new MailerError('INVALID_FEEDBACK_TIMESTAMP');
  let recipients = [];
  if (status === 'hard_bounce') recipients = event.bounce?.bouncedRecipients;
  if (status === 'complaint') recipients = event.complaint?.complainedRecipients;
  if (
    ['hard_bounce', 'complaint'].includes(status) &&
    (!Array.isArray(recipients) || !recipients.length || recipients.length > 50)
  )
    throw new MailerError('INVALID_FEEDBACK_RECIPIENTS');
  const recipientHashes = [...new Set(recipients.map((item) => addressHash(item?.emailAddress)))];
  const candidate = event.mail?.tags?.vanly_job;
  const candidateJobId =
    Array.isArray(candidate) && candidate.length === 1 && /^\d{1,18}$/.test(candidate[0])
      ? candidate[0]
      : null;
  return {
    topicArn: envelope.TopicArn,
    snsMessageId: envelope.MessageId,
    sqsMessageId: message.MessageId,
    providerMessageId: messageId,
    eventType,
    status,
    occurredAt: new Date(date).toISOString(),
    recipientHashes,
    candidateJobId,
  };
}
