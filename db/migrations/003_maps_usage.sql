-- Only application operation counts; never Google Places content or search text.
CREATE TABLE maps_usage (
  period text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('map','places')),
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  PRIMARY KEY(period, kind)
);
