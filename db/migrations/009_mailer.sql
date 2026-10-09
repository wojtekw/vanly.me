-- Existing pending mail remains compatible. Migration never sends mail.
ALTER TABLE jobs DROP CONSTRAINT jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
  CHECK(status IN ('pending','processing','done','failed','dead','unknown'));
ALTER TABLE jobs ADD COLUMN recipient_user_id uuid REFERENCES users ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN event_key text CHECK(event_key IS NULL OR length(event_key) BETWEEN 1 AND 256);
ALTER TABLE jobs ADD COLUMN provider text CHECK(provider IS NULL OR provider IN ('local','ses'));
ALTER TABLE jobs ADD COLUMN lease_token uuid;
ALTER TABLE jobs ADD COLUMN lease_until timestamptz;
ALTER TABLE jobs ADD COLUMN finished_at timestamptz;
UPDATE jobs j SET recipient_user_id=u.id
  FROM users u WHERE j.kind='mail' AND j.payload->>'userId'=u.id::text;
CREATE UNIQUE INDEX mail_jobs_event_recipient ON jobs(recipient_user_id,event_key)
  WHERE kind='mail' AND event_key IS NOT NULL;
CREATE INDEX mail_jobs_due ON jobs(next_run,id) WHERE kind='mail' AND status='pending';
CREATE INDEX mail_jobs_leases ON jobs(lease_until) WHERE kind='mail' AND status='processing';
ALTER TABLE local_mail ADD COLUMN job_id bigint REFERENCES jobs ON DELETE SET NULL;
ALTER TABLE local_mail ADD COLUMN html text;
ALTER TABLE local_mail ADD COLUMN text_body text;
ALTER TABLE local_mail ADD COLUMN template_id text;
CREATE UNIQUE INDEX local_mail_job ON local_mail(job_id) WHERE job_id IS NOT NULL;
CREATE TABLE mail_deliveries(
  id bigserial PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES jobs ON DELETE CASCADE,
  recipient_user_id uuid REFERENCES users ON DELETE SET NULL,
  attempt integer NOT NULL CHECK(attempt>0),
  provider text NOT NULL CHECK(provider IN ('local','ses')),
  provider_message_id text,
  status text NOT NULL CHECK(status IN ('processing','local','accepted','retry','dead','unknown')),
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(job_id,attempt)
);
CREATE INDEX mail_deliveries_lookup ON mail_deliveries(provider,provider_message_id)
  WHERE provider_message_id IS NOT NULL;
