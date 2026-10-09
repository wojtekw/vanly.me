ALTER TABLE mail_deliveries ADD COLUMN feedback_status text
  CHECK(feedback_status IN ('delayed','soft_bounce','delivered','rendering_failed','rejected','hard_bounce','complaint'));
ALTER TABLE mail_deliveries ADD COLUMN feedback_at timestamptz;
CREATE UNIQUE INDEX mail_deliveries_ses_message ON mail_deliveries(provider_message_id)
  WHERE provider='ses' AND provider_message_id IS NOT NULL;
CREATE TABLE mail_feedback(
  id bigserial PRIMARY KEY,
  topic_arn text NOT NULL,
  sns_message_id text NOT NULL,
  sqs_message_id text NOT NULL UNIQUE,
  provider_message_id text NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('Delivery','Bounce','Complaint','Reject','RenderingFailure','DeliveryDelay')),
  feedback_status text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recipient_hashes text[] NOT NULL DEFAULT '{}',
  candidate_job_id bigint,
  delivery_id bigint REFERENCES mail_deliveries ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(topic_arn,sns_message_id)
);
CREATE INDEX mail_feedback_unmatched ON mail_feedback(provider_message_id,id) WHERE delivery_id IS NULL;
CREATE TABLE mail_suppressions(
  address_hash text PRIMARY KEY CHECK(address_hash ~ '^[a-f0-9]{64}$'),
  reason text NOT NULL CHECK(reason IN ('hard_bounce','complaint')),
  feedback_id bigint REFERENCES mail_feedback ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
