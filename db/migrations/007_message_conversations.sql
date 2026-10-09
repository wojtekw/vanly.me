CREATE TABLE message_conversations (
  vehicle_id text NOT NULL REFERENCES vehicles,
  traveler_id uuid NOT NULL REFERENCES users,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(vehicle_id,traveler_id),
  CHECK((resolved_at IS NULL)=(resolved_by IS NULL))
);

-- Existing conversations start open; a reply alone does not establish resolution.
INSERT INTO message_conversations(vehicle_id,traveler_id,created_at,updated_at)
  SELECT vehicle_id,traveler_id,min(created_at),max(created_at)
  FROM messages GROUP BY vehicle_id,traveler_id;

-- Rollback after restoring the API version that does not use conversation status:
-- DROP TABLE message_conversations;
-- DELETE FROM schema_migrations WHERE name='007_message_conversations.sql';
-- Messages remain intact; explicit resolution state is lost on rollback.
