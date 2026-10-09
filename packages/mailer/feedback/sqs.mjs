import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { MailerError } from '../errors.mjs';

export function createSqsFeedbackAdapter(config, injectedClient) {
  const client =
    injectedClient ||
    new SQSClient({
      region: config.region,
      maxAttempts: 1,
      requestHandler: { connectionTimeout: config.timeoutMs, requestTimeout: config.timeoutMs },
    });
  const call = async (command) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    timeout.unref?.();
    try {
      return await client.send(command, { abortSignal: controller.signal });
    } catch {
      throw new MailerError('FEEDBACK_SQS_UNAVAILABLE', 'retry');
    } finally {
      clearTimeout(timeout);
    }
  };
  return {
    async receive() {
      const result = await call(
        new ReceiveMessageCommand({
          QueueUrl: config.feedbackQueueUrl,
          MaxNumberOfMessages: config.feedbackBatchSize,
          WaitTimeSeconds: 0,
          VisibilityTimeout: 120,
        }),
      );
      return result.Messages || [];
    },
    async acknowledge(message) {
      if (
        typeof message.ReceiptHandle !== 'string' ||
        !message.ReceiptHandle.length ||
        message.ReceiptHandle.length > 4096
      )
        throw new MailerError('INVALID_FEEDBACK_RECEIPT');
      await call(
        new DeleteMessageCommand({
          QueueUrl: config.feedbackQueueUrl,
          ReceiptHandle: message.ReceiptHandle,
        }),
      );
    },
    close() {
      if (!injectedClient) client.destroy();
    },
  };
}
