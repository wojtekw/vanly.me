-- Keep legacy company and vehicle places intact. New companies have no pickup
-- location; each vehicle owns its locality and optional street address.
ALTER TABLE companies ALTER COLUMN city DROP NOT NULL;
ALTER TABLE companies ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE companies ALTER COLUMN lng DROP NOT NULL;
ALTER TABLE vehicles ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE vehicles ALTER COLUMN lng DROP NOT NULL;
ALTER TABLE vehicles ADD COLUMN street text NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD COLUMN house_number text NOT NULL DEFAULT '';
ALTER TABLE vehicles ADD CONSTRAINT vehicle_pickup_coordinates_pair CHECK ((lat IS NULL) = (lng IS NULL));
ALTER TABLE vehicles ADD CONSTRAINT vehicle_pickup_latitude CHECK (lat BETWEEN -90 AND 90);
ALTER TABLE vehicles ADD CONSTRAINT vehicle_pickup_longitude CHECK (lng BETWEEN -180 AND 180);
ALTER TABLE vehicles ADD CONSTRAINT vehicle_pickup_address_length CHECK (char_length(street) <= 160 AND char_length(house_number) <= 30);
