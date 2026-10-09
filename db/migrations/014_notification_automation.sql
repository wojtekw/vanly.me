-- Additive notification state: legacy users are not silently labelled verified/subscribed.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
CREATE TABLE email_verification_tokens (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_user ON email_verification_tokens(user_id,created_at);
CREATE TABLE notification_events (
  recipient_user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  event_key text NOT NULL CHECK(length(event_key)<=240),
  job_id bigint REFERENCES jobs ON DELETE SET NULL,
  resource_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(recipient_user_id,event_key)
);
CREATE INDEX notification_resource_cooldown ON notification_events(recipient_user_id,resource_key,created_at DESC);
CREATE TABLE message_reads (
  vehicle_id text NOT NULL,
  traveler_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  read_through timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(vehicle_id,traveler_id,user_id),
  FOREIGN KEY(vehicle_id,traveler_id) REFERENCES message_conversations ON DELETE CASCADE
);
CREATE TABLE newsletter_subscriptions (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN('pending','confirmed','unsubscribed')),
  consent_version text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  origin text NOT NULL,
  CHECK(status!='confirmed' OR confirmed_at IS NOT NULL)
);
CREATE TABLE newsletter_tokens (
  token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN('confirm','unsubscribe')),
  expires_at timestamptz,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(kind='unsubscribe' OR expires_at IS NOT NULL)
);
CREATE INDEX newsletter_tokens_user ON newsletter_tokens(user_id,kind,created_at);
CREATE TABLE newsletter_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id text NOT NULL REFERENCES articles,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','ready','completed','cancelled')),
  subject text NOT NULL CHECK(length(subject) BETWEEN 3 AND 200 AND subject !~ E'[\\r\\n]'),
  created_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);
CREATE TABLE newsletter_campaign_recipients (
  campaign_id uuid NOT NULL REFERENCES newsletter_campaigns ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  job_id bigint REFERENCES jobs ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(campaign_id,user_id)
);
