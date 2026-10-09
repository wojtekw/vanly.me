import { normalizeFeedback } from './normalize.mjs';
import { FeedbackRepository } from './repository.mjs';
import { createSqsFeedbackAdapter } from './sqs.mjs';

export class FeedbackService {
  constructor(pool, config, options = {}) {
    this.config = config;
    this.repository = options.repository || new FeedbackRepository(pool);
    this.adapter = options.adapter || createSqsFeedbackAdapter(config, options.sqsClient);
  }
  async tick() {
    const messages = await this.adapter.receive();
    let invalid = 0;
    for (const message of messages) {
      let normalized;
      try {
        normalized = normalizeFeedback(message, this.config);
      } catch {
        invalid++;
        continue;
      } // Leave poison/untrusted messages for SQS redrive to DLQ.
      await this.repository.record(normalized);
      // Acknowledge only after DB commit. Lost acknowledgements dedup safely.
      await this.adapter.acknowledge(message);
    }
    await this.repository.reconcileKnown();
    return { received: messages.length, invalid };
  }
  close() {
    this.adapter.close?.();
  }
}
