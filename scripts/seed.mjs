import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import dotenv from 'dotenv';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
const scrypt = promisify(crypto.scrypt);
export async function hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const seed = JSON.parse(await fs.readFile(path.join(root, 'db/seed.json'), 'utf8'));
const marketplace = JSON.parse(await fs.readFile(path.join(root, 'db/marketplace.json'), 'utf8'));
const companies = [...seed.companies, ...marketplace.companies];
const vehicles = [...seed.vehicles, ...marketplace.vehicles];
const accounts = JSON.parse(await fs.readFile(path.join(root, '.local/accounts.json'), 'utf8'));
try {
  await db.query('BEGIN');
  for (const c of companies)
    await db.query(
      'INSERT INTO companies(id,name,city,lat,lng,verified,settings) VALUES($1,$2,$3,$4,$5,true,$6) ON CONFLICT(id) DO NOTHING',
      [
        c.id,
        c.name,
        c.city,
        c.lat,
        c.lng,
        JSON.stringify(
          c.settings || {
            minDays: 2,
            buffer: 1,
            prep: 19000,
            open: '09:00',
            close: '17:00',
          },
        ),
      ],
    );
  for (const a of accounts)
    await db.query(
      'INSERT INTO users(email,name,password_hash,role,company_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING',
      [a.email, a.name, await hash(a.password), a.role, a.company],
    );
  for (const v of vehicles)
    await db.query(
      `INSERT INTO vehicles(id,company_id,name,type,asset,city,lat,lng,seats,sleeps,daily,prep,deposit,min_days,auto,pets,instant,km,features,description,tagline,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'published') ON CONFLICT(id) DO NOTHING`,
      [
        v.id,
        v.company_id,
        v.name,
        v.type,
        v.asset || 'caravan.svg',
        v.city,
        v.lat,
        v.lng,
        v.seats,
        v.sleeps,
        v.daily,
        v.prep,
        v.deposit,
        v.min ?? v.min_days,
        v.auto,
        v.pets,
        v.instant,
        v.km,
        JSON.stringify(v.features),
        v.desc || v.description,
        v.tagline,
      ],
    );
  for (const c of companies)
    for (const e of seed.equipment) {
      const excludedTypes = e.id === 'bike' ? ['trailer'] : [];
      const inserted = await db.query(
        'INSERT INTO stock_items(company_id,id,name,quantity,price,unit,excluded_types) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id',
        [
          c.id,
          e.id,
          e.name,
          e.max,
          e.price,
          e.unit,
          JSON.stringify(excludedTypes),
        ],
      );
      // Seed compatibility only for new inventory, preserving explicit selections on a rerun.
      if (inserted.rowCount)
        await db.query(
          `INSERT INTO stock_item_vehicles(company_id,item_id,vehicle_id)
          SELECT $1,$2,id FROM vehicles WHERE company_id=$1 AND NOT(type=ANY($3::text[]))
          ON CONFLICT DO NOTHING`,
          [c.id, e.id, excludedTypes],
        );
    }
  for (const s of marketplace.seasons)
    await db.query(
      'INSERT INTO seasons(company_id,vehicle_id,start_date,end_date,rate,name) SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS(SELECT 1 FROM seasons WHERE vehicle_id=$2 AND start_date=$3 AND end_date=$4)',
      [s.company_id, s.vehicle_id, s.start_date, s.end_date, s.rate, s.name],
    );
  for (const a of seed.articles)
    await db.query(
      'INSERT INTO articles(id,title,kind,summary,body,asset,published) VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT DO NOTHING',
      [a.id, a.title, a.kind, a.desc, JSON.stringify(a.body), a.asset],
    );
  for (const c of seed.camps)
    await db.query(
      'INSERT INTO camps(id,name,region,lat,lng,features,description) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [c.id, c.name, c.place, c.lat, c.lng, JSON.stringify(c.features), c.desc],
    );
  await db.query('COMMIT');
  console.log('Seeded sample catalogue and local accounts; existing data preserved.');
} catch (e) {
  await db.query('ROLLBACK');
  throw e;
} finally {
  await db.end();
}
