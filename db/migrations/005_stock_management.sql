-- Archive inventory without removing historical bookings or their extras.
ALTER TABLE stock_items ADD COLUMN active boolean NOT NULL DEFAULT true;

-- Rollback: ALTER TABLE stock_items DROP COLUMN active;
-- Restore archived rows first if rolling back application code without this field.
