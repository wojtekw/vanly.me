-- Historical listing charges and traveler payments remain unchanged.
ALTER TABLE vehicles ADD CONSTRAINT vehicles_id_company_unique UNIQUE(id,company_id);
CREATE TABLE credit_wallets (
  company_id text PRIMARY KEY REFERENCES companies(id),
  balance integer NOT NULL DEFAULT 0 CHECK(balance>=0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vehicle_publications (
  vehicle_id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES credit_wallets(company_id),
  exempt boolean NOT NULL DEFAULT false,
  anchor_at timestamptz,
  months integer NOT NULL DEFAULT 0 CHECK(months>=0),
  valid_until timestamptz,
  auto_renew boolean NOT NULL DEFAULT false,
  paused_for_credits boolean NOT NULL DEFAULT false,
  FOREIGN KEY(vehicle_id,company_id) REFERENCES vehicles(id,company_id) ON DELETE CASCADE,
  CHECK((months=0 AND anchor_at IS NULL AND valid_until IS NULL) OR
        (months>0 AND anchor_at IS NOT NULL AND valid_until>anchor_at)),
  CHECK(NOT exempt OR months=0),
  CHECK(NOT paused_for_credits OR (auto_renew AND NOT exempt))
);
CREATE UNIQUE INDEX one_free_vehicle_per_company ON vehicle_publications(company_id) WHERE exempt;
CREATE INDEX publication_renewals ON vehicle_publications(valid_until,company_id) WHERE auto_renew AND NOT exempt;
CREATE TABLE credit_ledger (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL REFERENCES credit_wallets(company_id),
  user_id uuid,
  vehicle_id text,
  kind text NOT NULL CHECK(kind IN('purchase_test','publication','renewal','migration_grant')),
  credits integer NOT NULL CHECK(credits<>0),
  balance_after integer NOT NULL CHECK(balance_after>=0),
  amount_minor integer NOT NULL DEFAULT 0 CHECK(amount_minor>=0),
  currency text NOT NULL DEFAULT 'PLN' CHECK(currency='PLN'),
  period_start timestamptz,
  period_end timestamptz,
  event_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((kind='purchase_test' AND credits BETWEEN 1 AND 100000 AND amount_minor=credits*20000 AND vehicle_id IS NULL AND period_start IS NULL AND period_end IS NULL)
    OR (kind IN('publication','renewal') AND credits=-1 AND amount_minor=0 AND vehicle_id IS NOT NULL AND period_start IS NOT NULL AND period_end>period_start)
    OR (kind='migration_grant' AND credits>0 AND amount_minor=0 AND vehicle_id IS NULL AND period_start IS NULL AND period_end IS NULL))
);
CREATE INDEX credit_company_history ON credit_ledger(company_id,sequence DESC);
INSERT INTO credit_wallets(company_id) SELECT id FROM companies;
-- One free slot belongs permanently to the oldest vehicle, including a draft.
INSERT INTO vehicle_publications(vehicle_id,company_id,exempt,anchor_at,months,valid_until,auto_renew)
SELECT id,company_id,rn=1,
 CASE WHEN rn>1 AND status='published' THEN now() END,
 CASE WHEN rn>1 AND status='published' THEN 1 ELSE 0 END,
 CASE WHEN rn>1 AND status='published' THEN now()+interval '1 month' END,
 status='published'
FROM (SELECT v.*,row_number() OVER(PARTITION BY company_id ORDER BY created_at,id) rn FROM vehicles v) ranked;
-- Grant existing published paid slots their first month, with an auditable zero net balance.
INSERT INTO credit_ledger(company_id,kind,credits,balance_after,event_key)
SELECT company_id,'migration_grant',count(*)::int,count(*)::int,'credits.migration:'||company_id
FROM vehicle_publications WHERE months=1 GROUP BY company_id;
INSERT INTO credit_ledger(company_id,vehicle_id,kind,credits,balance_after,period_start,period_end,event_key)
SELECT company_id,vehicle_id,'publication',-1,
 (count(*) OVER(PARTITION BY company_id)-row_number() OVER(PARTITION BY company_id ORDER BY vehicle_id))::int,
 anchor_at,valid_until,'credits.migration.publication:'||vehicle_id
FROM vehicle_publications WHERE months=1 ORDER BY company_id,vehicle_id;
CREATE FUNCTION protect_credit_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Credit ledger is append-only'; END $$;
CREATE TRIGGER immutable_credit_history BEFORE UPDATE OR DELETE ON credit_ledger FOR EACH ROW EXECUTE FUNCTION protect_credit_history();
