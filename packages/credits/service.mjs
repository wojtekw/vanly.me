import { randomUUID } from 'node:crypto';
export const CREDIT_PRICE_MINOR = 20000;
export class CreditsError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}
// Calendar anniversaries keep the original day, including Jan 31 -> Feb 28 -> Mar 31.
export function monthAnniversary(anchor, months) {
  const date = new Date(anchor);
  const target = new Date(date);
  target.setUTCDate(1);
  target.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), last));
  return target;
}
export async function lockWallet(db, companyId) {
  const {
    rows: [company],
  } = await db.query('SELECT verified FROM companies WHERE id=$1 FOR SHARE', [companyId]);
  if (!company) throw new CreditsError('Nie znaleziono wypożyczalni.', 404);
  await db.query('INSERT INTO credit_wallets(company_id) VALUES($1) ON CONFLICT DO NOTHING', [
    companyId,
  ]);
  const {
    rows: [wallet],
  } = await db.query('SELECT * FROM credit_wallets WHERE company_id=$1 FOR UPDATE', [companyId]);
  return { ...wallet, verified: company.verified };
}
async function entry(db, wallet, data) {
  const balance = wallet.balance + data.credits;
  if (!Number.isSafeInteger(balance) || balance < 0 || balance > 2147483647)
    throw new CreditsError(
      'Brak Creditsów w portfelu. Zasil portfel lub zapisz ofertę jako szkic.',
    );
  const {
    rows: [receipt],
  } = await db.query(
    `INSERT INTO credit_ledger(company_id,user_id,vehicle_id,kind,credits,balance_after,amount_minor,period_start,period_end,event_key)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      wallet.company_id,
      data.userId ?? null,
      data.vehicleId ?? null,
      data.kind,
      data.credits,
      balance,
      data.amountMinor ?? 0,
      data.start ?? null,
      data.end ?? null,
      data.eventKey,
    ],
  );
  await db.query('UPDATE credit_wallets SET balance=$2,updated_at=now() WHERE company_id=$1', [
    wallet.company_id,
    balance,
  ]);
  wallet.balance = balance;
  return receipt;
}
export function purchaseCredits(db, wallet, credits, { userId, eventKey }) {
  if (!Number.isInteger(credits) || credits < 1 || credits > 100000)
    throw new CreditsError('Wybierz od 1 do 100 000 Creditsów.', 400);
  return entry(db, wallet, {
    kind: 'purchase_test',
    credits,
    amountMinor: credits * CREDIT_PRICE_MINOR,
    userId,
    eventKey,
  });
}
export async function registerPublication(db, wallet, vehicleId, exempt) {
  const {
    rows: [term],
  } = await db.query(
    'INSERT INTO vehicle_publications(vehicle_id,company_id,exempt) VALUES($1,$2,$3) RETURNING *',
    [vehicleId, wallet.company_id, exempt],
  );
  return term;
}
export async function publishVehicle(db, wallet, vehicleId, { now = new Date(), userId } = {}) {
  const {
    rows: [vehicle],
  } = await db.query('SELECT * FROM vehicles WHERE id=$1 FOR UPDATE', [vehicleId]);
  if (!vehicle) throw new CreditsError('Nie znaleziono pojazdu.', 404);
  if (vehicle.company_id !== wallet.company_id)
    throw new CreditsError('Brak dostępu do tej wypożyczalni.', 403);
  if (!wallet.verified)
    throw new CreditsError('Firma czeka na weryfikację. Zapisz ofertę jako szkic.', 403);
  const {
    rows: [term],
  } = await db.query(
    'SELECT * FROM vehicle_publications WHERE vehicle_id=$1 AND company_id=$2 FOR UPDATE',
    [vehicleId, wallet.company_id],
  );
  if (!term) throw new CreditsError('Brak okresu publikacji dla tego pojazdu.');
  if (!term.exempt && (!term.valid_until || new Date(term.valid_until) <= now)) {
    const until = monthAnniversary(now, 1);
    await entry(db, wallet, {
      kind: 'publication',
      credits: -1,
      userId,
      vehicleId,
      start: now,
      end: until,
      eventKey: `credits.publish:${vehicleId}:${now.toISOString()}`,
    });
    await db.query(
      'UPDATE vehicle_publications SET anchor_at=$2,months=1,valid_until=$3 WHERE vehicle_id=$1',
      [vehicleId, now, until],
    );
  }
  const {
    rows: [updated],
  } = await db.query(
    'UPDATE vehicle_publications SET auto_renew=true,paused_for_credits=false WHERE vehicle_id=$1 RETURNING *',
    [vehicleId],
  );
  await db.query("UPDATE vehicles SET status='published' WHERE id=$1", [vehicleId]);
  return updated;
}
export async function stopPublication(db, companyId, vehicleId) {
  await db.query(
    'UPDATE vehicle_publications SET auto_renew=false,paused_for_credits=false WHERE vehicle_id=$1 AND company_id=$2',
    [vehicleId, companyId],
  );
}
export async function renewPublications(pool, { now = new Date(), limit = 100 } = {}) {
  const { rows: companies } = await pool.query(
    `SELECT DISTINCT p.company_id FROM vehicle_publications p JOIN credit_wallets w ON w.company_id=p.company_id JOIN companies c ON c.id=p.company_id
    WHERE NOT p.exempt AND p.auto_renew AND ((p.valid_until<=$1 AND NOT p.paused_for_credits) OR (p.paused_for_credits AND w.balance>0 AND c.verified)) ORDER BY p.company_id LIMIT $2`,
    [now, limit],
  );
  const result = { renewed: 0, hidden: 0 };
  for (const { company_id: companyId } of companies) {
    const db = await pool.connect();
    let renewed = 0,
      hidden = 0;
    try {
      await db.query('BEGIN');
      const wallet = await lockWallet(db, companyId);
      const { rows: terms } = await db.query(
        `SELECT p.*,v.status FROM vehicle_publications p JOIN vehicles v ON v.id=p.vehicle_id
        WHERE p.company_id=$1 AND NOT p.exempt AND p.auto_renew AND (p.valid_until<=$2 OR p.paused_for_credits)
        ORDER BY p.valid_until,p.vehicle_id FOR UPDATE OF p,v`,
        [companyId, now],
      );
      for (const term of terms) {
        if (term.status !== 'published' && !term.paused_for_credits) continue;
        if (!wallet.verified || wallet.balance < 1) {
          if (!term.paused_for_credits || term.status !== 'hidden') {
            await db.query("UPDATE vehicles SET status='hidden' WHERE id=$1", [term.vehicle_id]);
            await db.query(
              'UPDATE vehicle_publications SET paused_for_credits=true WHERE vehicle_id=$1',
              [term.vehicle_id],
            );
            hidden++;
          }
          continue;
        }
        let anchor = new Date(term.anchor_at),
          months = term.months + 1,
          start = new Date(term.valid_until),
          end = monthAnniversary(anchor, months);
        // Charge for a newly visible month, never for skipped/hidden past months.
        if (term.paused_for_credits || end <= now) {
          anchor = now;
          months = 1;
          start = now;
          end = monthAnniversary(anchor, 1);
        }
        await entry(db, wallet, {
          kind: 'renewal',
          credits: -1,
          vehicleId: term.vehicle_id,
          start,
          end,
          eventKey: `credits.renewal:${term.vehicle_id}:${new Date(term.valid_until).toISOString()}`,
        });
        await db.query(
          'UPDATE vehicle_publications SET anchor_at=$2,months=$3,valid_until=$4,paused_for_credits=false WHERE vehicle_id=$1',
          [term.vehicle_id, anchor, months, end],
        );
        await db.query("UPDATE vehicles SET status='published' WHERE id=$1", [term.vehicle_id]);
        renewed++;
      }
      await db.query('COMMIT');
      result.renewed += renewed;
      result.hidden += hidden;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  return result;
}

// Explicit demo/fixture initializer. Never invoked by API or the production worker.
// Only supplied, newly imported vehicles without a term receive a demo month.
export async function grantDemoPublications(db, vehicleIds, { now = new Date() } = {}) {
  const { rows: companies } = await db.query(
    'SELECT DISTINCT company_id FROM vehicles WHERE id=ANY($1::text[]) ORDER BY company_id',
    [vehicleIds],
  );
  for (const { company_id: companyId } of companies) {
    const wallet = await lockWallet(db, companyId);
    const { rows: missing } = await db.query(
      'SELECT v.* FROM vehicles v WHERE v.id=ANY($1::text[]) AND v.company_id=$2 AND NOT EXISTS(SELECT 1 FROM vehicle_publications p WHERE p.vehicle_id=v.id) ORDER BY v.created_at,v.id',
      [vehicleIds, companyId],
    );
    let hasFree =
      (
        await db.query('SELECT 1 FROM vehicle_publications WHERE company_id=$1 AND exempt', [
          companyId,
        ])
      ).rowCount > 0;
    const payable = [];
    for (const vehicle of missing) {
      const exempt = !hasFree;
      hasFree = true;
      await registerPublication(db, wallet, vehicle.id, exempt);
      if (vehicle.status === 'published') {
        if (!exempt) payable.push(vehicle);
        else await publishVehicle(db, wallet, vehicle.id, { now });
      }
    }
    if (payable.length) {
      await entry(db, wallet, {
        kind: 'migration_grant',
        credits: payable.length,
        eventKey: `credits.demo:${companyId}:${randomUUID()}`,
      });
      for (const vehicle of payable) await publishVehicle(db, wallet, vehicle.id, { now });
    }
  }
}
