-- Documents are private, immutable event snapshots, not public media assets.
CREATE TABLE booking_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('summary','amendment','pickup','return')),
  version integer NOT NULL CHECK(version>0),
  event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 256),
  file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 180),
  content_type text NOT NULL DEFAULT 'application/pdf' CHECK(content_type='application/pdf'),
  content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 5242880),
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(booking_id,kind,version),
  UNIQUE(booking_id,event_key)
);
CREATE INDEX booking_documents_booking ON booking_documents(booking_id,created_at);
CREATE FUNCTION prevent_booking_document_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Booking documents are immutable; create a new version.';
END;
$$;
CREATE TRIGGER booking_document_immutable BEFORE UPDATE ON booking_documents
  FOR EACH ROW EXECUTE FUNCTION prevent_booking_document_update();
ALTER TABLE local_mail ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'
  CHECK(jsonb_typeof(attachments)='array');
