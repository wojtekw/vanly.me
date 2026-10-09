// Public reservation status is separate from the hold and handover lifecycle.
export const reservationStatusProjection = `CASE b.status
  WHEN 'held' THEN 'pending'
  WHEN 'expired' THEN 'cancelled'
  WHEN 'in_rental' THEN 'confirmed'
  WHEN 'completed' THEN 'confirmed'
  ELSE b.status END AS reservation_status`;
