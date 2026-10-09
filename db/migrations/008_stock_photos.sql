ALTER TABLE media ADD CONSTRAINT media_company_id_id_unique UNIQUE(company_id,id);

CREATE TABLE stock_item_photos(
  company_id text NOT NULL,
  item_id text NOT NULL,
  media_id uuid NOT NULL,
  position smallint NOT NULL CHECK(position BETWEEN 1 AND 6),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,item_id,media_id),
  UNIQUE(media_id),
  UNIQUE(company_id,item_id,position),
  FOREIGN KEY(company_id,item_id) REFERENCES stock_items(company_id,id) ON DELETE CASCADE,
  FOREIGN KEY(company_id,media_id) REFERENCES media(company_id,id) ON DELETE CASCADE
);

-- Existing inventory is preserved and starts with an empty photo collection.
-- Slots and the item row lock prevent simultaneous uploads exceeding six photos.
-- Rollback after restoring the previous API: DROP TABLE stock_item_photos;
-- ALTER TABLE media DROP CONSTRAINT media_company_id_id_unique;
-- DELETE FROM schema_migrations WHERE name='008_stock_photos.sql';
-- Uploaded media files remain intact; item-to-photo links are lost on rollback.
