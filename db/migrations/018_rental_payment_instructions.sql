-- Preserve the exact instructions accepted for each confirmed booking.
ALTER TABLE bookings ADD COLUMN payment_instructions text NOT NULL DEFAULT ''
  CHECK(length(payment_instructions)<=4000);
