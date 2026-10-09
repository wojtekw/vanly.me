ALTER TABLE reset_tokens ADD COLUMN created_at timestamptz;
UPDATE reset_tokens SET created_at=expires_at-interval '30 minutes';
ALTER TABLE reset_tokens ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE reset_tokens ALTER COLUMN created_at SET NOT NULL;
CREATE INDEX reset_tokens_user_created_idx ON reset_tokens(user_id,created_at DESC);
