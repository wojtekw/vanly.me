import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { deliveryFailure, MailerError } from '../errors.mjs';
import { validateAttachments, validateEncodedMessageSize } from '../attachments.mjs';

export function createSesProvider(config, injectedClient) {
  // The AWS default credential chain supplies credentials. SDK retries are disabled:
  // retrying an ambiguous SendEmail response can send a duplicate message.
  const client =
    injectedClient ||
    new SESv2Client({
      region: config.region,
      profile: config.awsProfile,
      maxAttempts: 1,
      requestHandler: { connectionTimeout: config.timeoutMs, requestTimeout: config.timeoutMs },
    });
  return {
    name: 'ses',
    async send(message, job) {
      const attachments = validateAttachments(message.attachments);
      validateEncodedMessageSize({ ...message, attachments });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      timeout.unref?.();
      try {
        const response = await client.send(
          new SendEmailCommand({
            FromEmailAddress: message.from || config.from,
            ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
            Destination: { ToAddresses: [job.email] },
            Content: {
              Simple: {
                Subject: { Charset: 'UTF-8', Data: message.subject },
                Body: {
                  Html: { Charset: 'UTF-8', Data: message.html },
                  Text: { Charset: 'UTF-8', Data: message.text },
                },
                ...(attachments.length ? { Attachments: attachments.map((item) => ({
                  FileName: item.fileName, ContentType: item.contentType,
                  RawContent: item.data, ContentDisposition: 'ATTACHMENT', ContentTransferEncoding: 'BASE64',
                })) } : {}),
                ...(message.headers?.length ? { Headers: message.headers } : {}),
              },
            },
            ConfigurationSetName: config.configurationSet,
            EmailTags: [
              { Name: 'vanly_job', Value: String(job.id) },
              { Name: 'vanly_template', Value: message.templateId },
            ],
          }),
          { abortSignal: controller.signal },
        );
        if (!response?.MessageId) throw new MailerError('SES_ACCEPTANCE_UNKNOWN', 'unknown');
        // Accepted is not delivered. Bounce/delivery event ingestion is a separate stage.
        return { messageId: response.MessageId, status: 'accepted' };
      } catch (error) {
        throw deliveryFailure(error);
      } finally {
        clearTimeout(timeout);
      }
    },
    close() {
      if (!injectedClient) client.destroy();
    },
  };
}
