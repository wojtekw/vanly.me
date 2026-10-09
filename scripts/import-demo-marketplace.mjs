import { grantDemoPublications } from '../packages/credits/service.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import dotenv from 'dotenv';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(root, '.env.local'), quiet: true });
const connection = new URL(process.env.DATABASE_URL);
if (
  !['127.0.0.1', 'localhost'].includes(connection.hostname) ||
  connection.pathname !== '/vanly_local'
)
  throw new Error('Import is limited to the local Vanly database.');
const fixture = JSON.parse(await fs.readFile(path.join(root, 'db/marketplace.json'), 'utf8'));
const seed = JSON.parse(await fs.readFile(path.join(root, 'db/seed.json'), 'utf8'));
if (!fixture.fictional || fixture.companies.length !== 7 || fixture.vehicles.length !== 30)
  throw new Error('Unexpected marketplace fixture.');

const firstNames = [
  'Anna',
  'Michał',
  'Katarzyna',
  'Piotr',
  'Agnieszka',
  'Tomasz',
  'Magdalena',
  'Paweł',
  'Joanna',
  'Marcin',
  'Natalia',
  'Jakub',
  'Aleksandra',
  'Krzysztof',
  'Monika',
  'Łukasz',
  'Karolina',
  'Mateusz',
  'Marta',
  'Adam',
];
const lastNames = ['Kowalska', 'Nowak', 'Wiśniewska', 'Wójcik', 'Kamiński'];
const travelers = firstNames.flatMap((first, i) =>
  lastNames.map((last, j) => ({
    email: `podroznik${String(i * lastNames.length + j + 1).padStart(3, '0')}@demo.vanly.local`,
    name: `${first} ${last}`,
    role: 'traveler',
    company: null,
    profile: {
      phone: '',
      drivers: [],
      marketing: false,
      demo: true,
      homeCity: ['Warszawa', 'Kraków', 'Gdańsk', 'Poznań', 'Wrocław'][j],
    },
  })),
);
const companiesNeedingDemoOwner = [
  ...fixture.companies,
  ...seed.companies.filter((c) => !['baltic', 'slow-roads'].includes(c.id)),
];
const owners = companiesNeedingDemoOwner.map((c) => ({
  email: `wlasciciel.${c.id}@demo.vanly.local`,
  name: c.name,
  role: 'owner',
  company: c.id,
  profile: { phone: '', drivers: [], marketing: false, demo: true },
}));
const password = 'VanlyDemo!2026';
const scrypt = promisify(crypto.scrypt),
  salt = crypto.randomBytes(16).toString('hex');
const passwordHash = salt + ':' + (await scrypt(password, salt, 64)).toString('hex');
const accounts = [...owners, ...travelers].map((a) => ({ ...a, password }));
const accountFile = path.join(root, '.local/demo-accounts.json');
await fs.writeFile(accountFile, JSON.stringify(accounts, null, 2) + '\n', { mode: 0o600 });
await fs.chmod(accountFile, 0o600);

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query('BEGIN');
  const ids = fixture.vehicles.map((v) => v.id),
    companyIds = fixture.companies.map((c) => c.id),
    emails = accounts.map((a) => a.email);
  const backupPath = path.join(
    root,
    '.local/backups',
    'marketplace-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json',
  );
  await fs.mkdir(path.dirname(backupPath), { recursive: true, mode: 0o700 });
  const before = {
    companies: (await db.query('SELECT * FROM companies WHERE id=ANY($1::text[])', [companyIds]))
      .rows,
    vehicles: (await db.query('SELECT * FROM vehicles WHERE id=ANY($1::text[])', [ids])).rows,
    users: (
      await db.query(
        'SELECT id,email,name,role,company_id,profile FROM users WHERE email=ANY($1::text[])',
        [emails],
      )
    ).rows,
  };
  await fs.writeFile(backupPath, JSON.stringify(before, null, 2), { mode: 0o600 });
  for (const c of fixture.companies)
    await db.query(
      `INSERT INTO companies(id,name,city,lat,lng,verified,settings) VALUES($1,$2,$3,$4,$5,true,$6)
     ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,city=EXCLUDED.city,lat=EXCLUDED.lat,lng=EXCLUDED.lng,verified=true,settings=EXCLUDED.settings`,
      [c.id, c.name, c.city, c.lat, c.lng, JSON.stringify(c.settings)],
    );
  for (const v of fixture.vehicles)
    await db.query(
      `INSERT INTO vehicles(id,company_id,name,type,asset,city,lat,lng,seats,sleeps,daily,prep,deposit,min_days,auto,pets,instant,km,features,description,tagline,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'published')
     ON CONFLICT(id) DO UPDATE SET company_id=EXCLUDED.company_id,name=EXCLUDED.name,type=EXCLUDED.type,asset=EXCLUDED.asset,city=EXCLUDED.city,lat=EXCLUDED.lat,lng=EXCLUDED.lng,seats=EXCLUDED.seats,sleeps=EXCLUDED.sleeps,daily=EXCLUDED.daily,prep=EXCLUDED.prep,deposit=EXCLUDED.deposit,min_days=EXCLUDED.min_days,auto=EXCLUDED.auto,pets=EXCLUDED.pets,instant=EXCLUDED.instant,km=EXCLUDED.km,features=EXCLUDED.features,description=EXCLUDED.description,tagline=EXCLUDED.tagline,status='published'`,
      [
        v.id,
        v.company_id,
        v.name,
        v.type,
        v.asset,
        v.city,
        v.lat,
        v.lng,
        v.seats,
        v.sleeps,
        v.daily,
        v.prep,
        v.deposit,
        v.min_days,
        v.auto,
        v.pets,
        v.instant,
        v.km,
        JSON.stringify(v.features),
        v.description,
        v.tagline,
      ],
    );
  await db.query('DELETE FROM seasons WHERE vehicle_id=ANY($1::text[])', [ids]);
  for (const s of fixture.seasons)
    await db.query(
      'INSERT INTO seasons(company_id,vehicle_id,start_date,end_date,rate,name) VALUES($1,$2,$3,$4,$5,$6)',
      [s.company_id, s.vehicle_id, s.start_date, s.end_date, s.rate, s.name],
    );
  for (const c of fixture.companies)
    for (const e of seed.equipment) {
      const excludedTypes = e.id === 'bike' ? ['trailer'] : [];
      const values = [c.id, e.id, e.name, e.max, e.price, e.unit, JSON.stringify(excludedTypes)];
      const inserted = await db.query(
        'INSERT INTO stock_items(company_id,id,name,quantity,price,unit,excluded_types) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id',
        values,
      );
      if (inserted.rowCount) {
        await db.query(
          `INSERT INTO stock_item_vehicles(company_id,item_id,vehicle_id)
          SELECT $1,$2,id FROM vehicles WHERE company_id=$1 AND NOT(type=ANY($3::text[]))
          ON CONFLICT DO NOTHING`,
          [c.id, e.id, excludedTypes],
        );
      } else {
        await db.query(
          'UPDATE stock_items SET name=$3,quantity=$4,price=$5,unit=$6,excluded_types=$7 WHERE company_id=$1 AND id=$2',
          values,
        );
      }
    }
  for (const a of accounts)
    await db.query(
      `INSERT INTO users(email,name,password_hash,role,company_id,profile) VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,company_id=EXCLUDED.company_id,profile=EXCLUDED.profile`,
      [a.email, a.name, passwordHash, a.role, a.company, JSON.stringify(a.profile)],
    );
  await grantDemoPublications(db,ids);
  await db.query('COMMIT');
  console.log(
    `Imported ${fixture.companies.length} companies, ${fixture.vehicles.length} vehicles, ${owners.length} owners and ${travelers.length} travelers. Backup: ${backupPath}`,
  );
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  await db.end();
}
