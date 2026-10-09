-- Equipment compatibility belongs to an individual vehicle, independent of its type.
ALTER TABLE vehicles ADD CONSTRAINT vehicles_company_id_id_unique UNIQUE(company_id,id);

CREATE TABLE stock_item_vehicles(
  company_id text NOT NULL,
  item_id text NOT NULL,
  vehicle_id text NOT NULL,
  PRIMARY KEY(company_id,item_id,vehicle_id),
  FOREIGN KEY(company_id,item_id) REFERENCES stock_items(company_id,id) ON DELETE CASCADE,
  FOREIGN KEY(company_id,vehicle_id) REFERENCES vehicles(company_id,id) ON DELETE CASCADE
);
CREATE INDEX stock_item_vehicles_vehicle ON stock_item_vehicles(company_id,vehicle_id);

-- Preserve the legacy rules for the company's existing fleet, including drafts and archives.
INSERT INTO stock_item_vehicles(company_id,item_id,vehicle_id)
SELECT s.company_id,s.id,v.id FROM stock_items s JOIN vehicles v ON v.company_id=s.company_id
WHERE NOT(s.excluded_types ? v.type);

-- Rollback: DROP TABLE stock_item_vehicles;
-- ALTER TABLE vehicles DROP CONSTRAINT vehicles_company_id_id_unique;
-- Vehicle-specific selections cannot be fully represented by legacy excluded_types.
