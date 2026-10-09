// Public reads fail closed even if the renewal worker is temporarily unavailable.
export const publicListing = (alias = 'v') =>
  `EXISTS(SELECT 1 FROM vehicle_publications vp WHERE vp.vehicle_id=${alias}.id AND vp.company_id=${alias}.company_id AND (vp.exempt OR vp.valid_until>now()))`;
