-- Existing reservations retain their history and operational lifecycle.
-- New reservations always require the rental company's explicit decision.
ALTER TABLE vehicles ALTER COLUMN instant SET DEFAULT false;
UPDATE vehicles SET instant=false WHERE instant;
