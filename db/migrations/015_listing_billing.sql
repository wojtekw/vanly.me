ALTER TABLE bookings DROP CONSTRAINT bookings_payment_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_status_check
  CHECK(payment_status IN ('unpaid','partial','paid','refund_pending','refunded','external'));

CREATE TABLE vehicle_listing_fees (
  vehicle_id text PRIMARY KEY REFERENCES vehicles(id),
  company_id text NOT NULL REFERENCES companies(id),
  amount_minor integer NOT NULL CHECK(amount_minor IN (0,20000)),
  currency text NOT NULL DEFAULT 'PLN' CHECK(currency='PLN'),
  status text NOT NULL CHECK(status IN ('waived','pending','paid_test')),
  reason text NOT NULL CHECK(reason IN ('legacy','first_vehicle','additional_vehicle')),
  provider text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((status='waived' AND amount_minor=0 AND paid_at IS NULL AND provider IS NULL)
     OR (status='pending' AND amount_minor=20000 AND paid_at IS NULL AND provider IS NULL)
     OR (status='paid_test' AND amount_minor=20000 AND paid_at IS NOT NULL AND provider='local_test'))
);
CREATE INDEX vehicle_listing_fees_company ON vehicle_listing_fees(company_id,created_at);
-- Existing inventory is grandfathered; no retroactive collection or changes to bookings.
INSERT INTO vehicle_listing_fees(vehicle_id,company_id,amount_minor,status,reason)
  SELECT id,company_id,0,'waived','legacy' FROM vehicles;
