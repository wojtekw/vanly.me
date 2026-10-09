import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Req,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { z } from 'zod';
import { q, pool, tx, expireHolds, audit, mail } from './db';
import { user, companyScope, Authed, User, hash } from './auth';
import { normalizeLocality, resolveLocality, searchLocalities } from './localities';
import { notifyCompanyOnboarding, notifyTeamMemberCreated } from './notifications/service-events';
import { requestEmailVerification } from './accounts/email-verification';
import { trustedRequestOrigin } from './request-origin';
import {
  listingBilling,
  listingIdempotency,
  payListingFee,
  LISTING_FEE_MINOR,
} from './listing-billing';
import { legacyTravelerPayments } from './booking/payment-mode';
import {
  calcQuote,
  quoteSchema,
  dateSchema,
  day,
  days,
  today,
  accessibleBooking,
  stockUsage,
  stockMinimum,
} from './bookings';
@Controller('api/v1')
export class CatalogController {
  @Get('health') async health() {
    await pool.query('SELECT 1');
    return {
      ok: true,
      database: 'postgresql',
      payments: process.env.LOCAL_PAYMENTS === 'true' ? 'local_test' : 'disabled',
      travelerPayments: legacyTravelerPayments() ? 'local_test' : 'direct',
      listingFeeMinor: LISTING_FEE_MINOR,
      insurance: 'not_connected',
      vignettes: 'not_connected',
    };
  }
  @Get('catalog') async catalogue(@Query() params: any) {
    const d = z
      .object({
        location: z.string().trim().max(80).optional(),
        radius: z.coerce.number().min(1).max(500).default(50),
        start: dateSchema.optional(),
        end: dateSchema.optional(),
        guests: z.coerce.number().int().min(1).max(12).default(1),
        type: z.string().max(30).optional(),
        budget: z.coerce.number().int().min(0).max(100000000).optional(),
        auto: z.enum(['true', 'false']).optional(),
        pets: z.enum(['true', 'false']).optional(),
        instant: z.enum(['true', 'false']).optional(),
        feature: z
          .union([
            z.enum(['shower', 'kitchen', 'heat']),
            z.array(z.enum(['shower', 'kitchen', 'heat'])).max(3),
          ])
          .transform((value) => [...new Set(Array.isArray(value) ? value : [value])])
          .optional(),
        sort: z.enum(['recommended', 'price', 'price-desc']).default('recommended'),
      })
      .parse(params);
    await expireHolds();
    const values: any[] = [];
    const arg = (v: any) => {
      values.push(v);
      return '$' + values.length;
    };
    let where = "v.status='published' AND c.verified";
    where += ` AND v.sleeps>=${arg(d.guests)} AND (v.type='trailer' OR v.seats>=${arg(d.guests)})`;
    if (d.type && d.type !== 'all') where += ` AND v.type=${arg(d.type)}`;
    for (const k of ['auto', 'pets', 'instant'] as const)
      if (d[k] === 'true') where += ` AND v.${k}=true`;
    let distance = 'NULL::float8';
    if (d.location) {
      let loc: { lat: number; lng: number } | undefined = resolveLocality(d.location);
      if (!loc) {
        const places = await q(
          `SELECT DISTINCT v.lat,v.lng FROM vehicles v JOIN companies c ON c.id=v.company_id WHERE v.status='published' AND c.verified AND v.lat IS NOT NULL AND v.lng IS NOT NULL AND translate(lower(v.city),'ąćęłńóśźż','acelnoszz')=$1 LIMIT 2`,
          [normalizeLocality(d.location)],
        );
        if (places.length === 1) loc = places[0];
      }
      const matchingCity = `translate(lower(v.city),'ąćęłńóśźż','acelnoszz') LIKE ${arg('%' + normalizeLocality(d.location).replace(/[\\%_]/g, '\\$&') + '%')}`;
      if (loc) {
        // PostgreSQL least/greatest ignore NULL, so guard missing coordinates
        // before clamping the acos input; they must never appear 0 km away.
        distance = `CASE WHEN v.lat IS NULL OR v.lng IS NULL THEN NULL::float8 ELSE 6371*acos(least(1,greatest(-1,sin(radians(v.lat))*sin(radians(${arg(loc.lat)}::float8))+cos(radians(v.lat))*cos(radians(${arg(loc.lat)}::float8))*cos(radians(v.lng-${arg(loc.lng)}::float8))))) END`;
        where += ` AND (${distance}<=${arg(d.radius)} OR (v.lat IS NULL AND ${matchingCity}))`;
      } else where += ` AND ${matchingCity}`;
    }
    let total = "v.daily+COALESCE((c.settings->>'prep')::int,v.prep)";
    if (d.start && d.end) {
      const n = days(d.start, d.end);
      if (d.start < today() || n < 1 || n > 60)
        throw new BadRequestException('Nieprawidłowy termin.');
      const start = arg(d.start),
        end = arg(d.end);
      where += ` AND NOT EXISTS(SELECT 1 FROM allocations a WHERE a.vehicle_id=v.id AND a.active AND a.occupied && daterange(${start}::date,${end}::date+coalesce((c.settings->>'buffer')::int,1),'[)')) AND greatest(v.min_days,coalesce((c.settings->>'minDays')::int,2))<=${arg(n)}`;
      total = `(SELECT COALESCE(sum(COALESCE((SELECT s.rate FROM seasons s WHERE s.company_id=v.company_id AND (s.vehicle_id IS NULL OR s.vehicle_id=v.id) AND s.start_date<=g.date AND s.end_date>g.date ORDER BY (s.vehicle_id IS NOT NULL) DESC,s.start_date DESC LIMIT 1),v.daily)),0)::int FROM generate_series(${start}::date,${end}::date-1,interval '1 day')g(date))+COALESCE((c.settings->>'prep')::int,v.prep)`;
    }
    for (const feature of d.feature || []) {
      const pattern = { shower: 'prysznic', kitchen: 'kuch|aneks', heat: 'ogrzew' }[feature];
      where += ` AND v.features::text ~* ${arg(pattern)}`;
    }
    if (d.budget) where += ` AND (${total})<=${arg(d.budget)}`;
    const order =
      d.sort === 'price'
        ? 'total_minor ASC'
        : d.sort === 'price-desc'
          ? 'total_minor DESC'
          : 'v.created_at,v.name';
    return q(
      `SELECT v.*,c.name company_name,c.settings,(${total}) total_minor,${distance} distance_km,(SELECT round(avg(rating),1) FROM comments r WHERE r.vehicle_id=v.id AND r.type='review' AND r.status='published') rating,(SELECT count(*)::int FROM comments r WHERE r.vehicle_id=v.id AND r.type='review' AND r.status='published') review_count FROM vehicles v JOIN companies c ON c.id=v.company_id WHERE ${where} ORDER BY ${order} LIMIT 1000`,
      values,
    );
  }
  @Get('locations') async locations() {
    return q(
      "SELECT DISTINCT v.city,v.lat,v.lng FROM vehicles v JOIN companies c ON c.id=v.company_id WHERE v.status='published' AND c.verified ORDER BY v.city",
    );
  }
  @Get('localities') localities(@Query('q') query: unknown) {
    return searchLocalities(z.string().trim().max(160).default('').parse(query));
  }
  @Get('seo/inventory') async seoInventory() {
    const [vehicles, articles] = await Promise.all([
      q(
        "SELECT v.id FROM vehicles v JOIN companies c ON c.id=v.company_id WHERE v.status='published' AND c.verified ORDER BY v.id",
      ),
      q('SELECT id,updated_at FROM articles WHERE published ORDER BY id'),
    ]);
    return { vehicles, articles };
  }
  @Get('vehicles/:id') async vehicle(@Param('id') id: string, @Query() p: any, @Req() req: Authed) {
    const [v] = await q(
      `SELECT v.*,c.name company_name,c.settings,c.verified FROM vehicles v JOIN companies c ON c.id=v.company_id WHERE v.id=$1`,
      [id],
    );
    if (
      !v ||
      ((v.status !== 'published' || !v.verified) &&
        req.user?.role !== 'admin' &&
        req.user?.company_id !== v.company_id)
    )
      throw new NotFoundException('Oferta jest niedostępna.');
    let equipment = await q(
      `SELECT s.* FROM stock_items s JOIN stock_item_vehicles sv
        ON sv.company_id=s.company_id AND sv.item_id=s.id
        WHERE s.company_id=$1 AND s.active AND sv.vehicle_id=$2 ORDER BY s.id`,
      [v.company_id, v.id],
    );
    // Public equipment has already been selected for this exact vehicle.
    equipment = equipment.map((e) => ({ ...e, excluded_types: [] }));
    if (p.start && p.end) {
      dateSchema.parse(p.start);
      dateSchema.parse(p.end);
      if (p.end <= p.start) throw new BadRequestException('Sprawdź daty.');
      const reserved = await stockUsage(pool, v.company_id, p.start, p.end);
      equipment = equipment.map((e) => ({
        ...e,
        available: e.quantity - (reserved.find((r) => r.item_id === e.id)?.used || 0),
      }));
    } else equipment = equipment.map((e) => ({ ...e, available: e.quantity }));
    const comments = await q(
      `SELECT r.id,r.type,r.text,r.rating,r.reply,r.created_at,u.name author FROM comments r JOIN users u ON u.id=r.author_id WHERE r.vehicle_id=$1 AND r.status='published' ORDER BY r.created_at DESC`,
      [id],
    );
    const similar = await q(
      `SELECT v.id,v.name,v.asset,v.city,v.daily FROM vehicles v JOIN companies c ON c.id=v.company_id
        WHERE v.id<>$1 AND v.status='published' AND c.verified ORDER BY (v.type=$2) DESC LIMIT 3`,
      [id, v.type],
    );
    return { ...v, equipment, comments, similar };
  }
  @Post('preview-quote') async preview(@Body() body: unknown) {
    const input = quoteSchema.parse(body);
    return tx(async (db) => {
      await expireHolds(db);
      return calcQuote(db, input);
    });
  }
  @Get('favorites') async favorites(@Req() req: Authed) {
    const u = user(req);
    return q(
      "SELECT v.*,c.name company_name FROM favorites f JOIN vehicles v ON v.id=f.vehicle_id JOIN companies c ON c.id=v.company_id WHERE f.user_id=$1 AND v.status='published' AND c.verified",
      [u.id],
    );
  }
  @Post('favorites/:id') async favorite(@Req() req: Authed, @Param('id') id: string) {
    const u = user(req);
    return tx(async (db) => {
      const [vehicle] = await q(
        `SELECT v.id FROM vehicles v JOIN companies c ON c.id=v.company_id
        WHERE v.id=$1 AND v.status='published' AND c.verified FOR SHARE OF v,c`,
        [id],
        db,
      );
      if (!vehicle) throw new NotFoundException('Ta oferta nie jest dostępna.');
      await q(
        'INSERT INTO favorites(user_id,vehicle_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [u.id, id],
        db,
      );
      return { ok: true };
    });
  }
  @Delete('favorites/:id') async unfavorite(@Req() req: Authed, @Param('id') id: string) {
    const u = user(req);
    await q('DELETE FROM favorites WHERE user_id=$1 AND vehicle_id=$2', [u.id, id]);
    return { ok: true };
  }
  @Get('articles') async articles(@Query('kind') kind?: string) {
    return q(
      'SELECT * FROM articles WHERE published AND ($1::text IS NULL OR kind=$1) ORDER BY updated_at DESC',
      [kind || null],
    );
  }
  @Get('articles/:id') async article(@Param('id') id: string) {
    const [a] = await q('SELECT * FROM articles WHERE id=$1 AND published', [id]);
    if (!a) throw new NotFoundException();
    return a;
  }
  @Get('camps') async camps() {
    return q('SELECT * FROM camps ORDER BY name');
  }
  @Get('mail') async localMail(@Req() req: Authed) {
    const u = user(req);
    return q(
      `SELECT m.id,m.subject,m.body,m.created_at,COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'documentId',d.id,'bookingId',d.booking_id,'fileName',d.file_name,
          'kind',d.kind,'version',d.version,'contentType',d.content_type,
          'size',octet_length(d.content),'sha256',d.sha256) ORDER BY ref.position)
        FROM jsonb_array_elements(m.attachments) WITH ORDINALITY ref(metadata,position)
        JOIN booking_documents d ON d.id::text=ref.metadata->>'documentId'
        JOIN bookings b ON b.id=d.booking_id
        WHERE $3::text='admin' OR b.user_id=$1 OR ($3::text='owner' AND b.company_id=$2)
      ),'[]'::jsonb) attachments
      FROM local_mail m WHERE m.user_id=$1 ORDER BY m.created_at DESC LIMIT 50`,
      [u.id, u.company_id, u.role],
    );
  }
  @Post('company-onboarding') async onboarding(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req, ['traveler']);
    const d = z
      .object({
        name: z.string().trim().min(3).max(100),
      })
      .parse(body);
    return tx(async (db) => {
      const [account] = await q(
        'SELECT role,company_id FROM users WHERE id=$1 FOR UPDATE',
        [u.id],
        db,
      );
      if (!account || account.role !== 'traveler' || account.company_id)
        throw new ConflictException('To konto ma już przypisaną wypożyczalnię.');
      const id = 'company-' + crypto.randomUUID();
      await db.query('INSERT INTO companies(id,name) VALUES($1,$2)', [id, d.name]);
      await db.query("UPDATE users SET role='owner',company_id=$1 WHERE id=$2", [id, u.id]);
      await audit(db, u, 'company.onboarding', id);
      await notifyCompanyOnboarding(db, u.id, id);
      return { id, status: 'pending_verification' };
    });
  }
}
const vehicleSchema = z
  .object({
    name: z.string().min(3).max(100),
    type: z.enum(['campervan', 'semi', 'alcove', 'offroad', 'trailer']),
    city: z.string().trim().min(2).max(80),
    street: z.string().trim().max(160).optional(),
    house_number: z.string().trim().max(30).optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    seats: z.number().int().min(0).max(12),
    sleeps: z.number().int().min(1).max(12),
    daily: z.number().int().min(100).max(1000000),
    prep: z.number().int().min(0).max(1000000),
    deposit: z.number().int().min(0).max(10000000),
    min_days: z.number().int().min(1).max(60),
    auto: z.boolean(),
    pets: z.boolean(),
    instant: z.boolean(),
    km: z.number().int().positive().max(10000).nullable(),
    description: z.string().min(10).max(5000),
    tagline: z.string().max(150),
    features: z.array(z.string().min(1).max(100)).max(30),
    asset: z.enum([
      'campervan.webp',
      'semi.webp',
      'alcove.webp',
      'offroad.webp',
      'minivan.webp',
      'caravan.svg',
    ]),
    status: z.enum(['draft', 'published', 'hidden']),
  })
  .strict();
const stockSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    quantity: z.number().int().min(0).max(1000),
    price: z.number().int().min(0).max(1000000),
    unit: z.enum(['day', 'trip']),
    excludedTypes: z
      .array(z.enum(['campervan', 'semi', 'alcove', 'offroad', 'trailer']))
      .max(5)
      .refine((types) => new Set(types).size === types.length, 'Wybierz każdy typ tylko raz.')
      .optional(),
    vehicleIds: z
      .array(z.string().trim().min(1).max(80))
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length, 'Wybierz każdy pojazd tylko raz.')
      .optional(),
  })
  .strict();
const stockPatchSchema = stockSchema
  .extend({ active: z.boolean() })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'Podaj co najmniej jedno pole.');
async function resolveStockVehicles(
  db: any,
  company: string,
  vehicleIds?: string[],
  excludedTypes?: string[],
) {
  if (vehicleIds !== undefined) {
    const vehicles = await q(
      'SELECT id FROM vehicles WHERE company_id=$1 AND id=ANY($2::text[]) ORDER BY id',
      [company, vehicleIds],
      db,
    );
    if (vehicles.length !== vehicleIds.length)
      throw new BadRequestException('Wybierz pojazdy należące do Twojej wypożyczalni.');
    return vehicles.map((v) => v.id as string);
  }
  if (excludedTypes !== undefined) {
    const vehicles = await q(
      'SELECT id FROM vehicles WHERE company_id=$1 AND NOT(type=ANY($2::text[])) ORDER BY id',
      [company, excludedTypes],
      db,
    );
    return vehicles.map((v) => v.id as string);
  }
  return [];
}
async function saveStockVehicles(db: any, company: string, item: string, vehicleIds: string[]) {
  await db.query('DELETE FROM stock_item_vehicles WHERE company_id=$1 AND item_id=$2', [
    company,
    item,
  ]);
  await db.query(
    'INSERT INTO stock_item_vehicles(company_id,item_id,vehicle_id) SELECT $1,$2,unnest($3::text[])',
    [company, item, vehicleIds],
  );
}
const pickupCoordinates = z
  .object({
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
  })
  .refine((d) => (d.lat === null) === (d.lng === null), {
    message: 'Podaj obie współrzędne miejsca odbioru albo pozostaw je puste.',
    path: ['lng'],
  });
function requireCoordinatePair(input: { lat?: number | null; lng?: number | null }) {
  if ((input.lat === undefined) !== (input.lng === undefined))
    throw new BadRequestException('Podaj obie współrzędne miejsca odbioru albo pozostaw je puste.');
}
@Controller('api/v1/owner')
export class OwnerController {
  @Get('dashboard') async dashboard(@Req() req: Authed) {
    const u = user(req, ['owner']);
    await expireHolds();
    const vehicles = await q('SELECT * FROM vehicles WHERE company_id=$1 ORDER BY name', [
      u.company_id,
    ]);
    const bookings = await q(
      `SELECT b.*,v.name vehicle_name,v.asset,us.name traveler_name FROM bookings b JOIN vehicles v ON v.id=b.vehicle_id JOIN users us ON us.id=b.user_id WHERE b.company_id=$1 AND b.status!='held' AND b.status!='expired' ORDER BY b.start_date DESC LIMIT 150`,
      [u.company_id],
    );
    const blocks = await q(
      'SELECT * FROM allocations WHERE company_id=$1 AND booking_id IS NULL AND active',
      [u.company_id],
    );
    const tasks = await q('SELECT * FROM tasks WHERE company_id=$1 ORDER BY created_at DESC', [
      u.company_id,
    ]);
    const [company] = await q('SELECT * FROM companies WHERE id=$1', [u.company_id]);
    const team = await q('SELECT id,name,email,role FROM users WHERE company_id=$1', [
      u.company_id,
    ]);
    const seasons = await q('SELECT * FROM seasons WHERE company_id=$1 ORDER BY start_date', [
      u.company_id,
    ]);
    return {
      company,
      vehicles,
      bookings,
      blocks,
      tasks,
      team,
      seasons,
      billing: await listingBilling(u.company_id!),
    };
  }
  @Get('billing') billing(@Req() req: Authed) {
    return listingBilling(user(req, ['owner']).company_id!);
  }
  @Post('vehicles/:id/listing-fee/pay-test') payListing(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return payListingFee(user(req, ['owner']), id, body, req.headers['idempotency-key']);
  }
  @Post('vehicles') async createVehicle(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req, ['owner']),
      d = vehicleSchema.parse(body);
    requireCoordinatePair(d);
    d.street ??= '';
    d.house_number ??= '';
    d.lat ??= null;
    d.lng ??= null;
    pickupCoordinates.parse(d);
    const id = 'van-' + crypto.randomUUID();
    const values = Object.values(d).map((v) => (Array.isArray(v) ? JSON.stringify(v) : v));
    return tx((db) =>
      listingIdempotency.run(
        db,
        u,
        'vehicle.create',
        req.headers['idempotency-key'],
        d,
        async () => {
          const [c] = await q(
            'SELECT verified FROM companies WHERE id=$1 FOR UPDATE',
            [u.company_id],
            db,
          );
          if (d.status === 'published' && !c?.verified)
            throw new ForbiddenException('Firma czeka na weryfikację. Zapisz ofertę jako szkic.');
          const [count] = await q(
            'SELECT count(*)::int n FROM vehicles WHERE company_id=$1',
            [u.company_id],
            db,
          );
          const amount = count.n === 0 ? 0 : LISTING_FEE_MINOR;
          await q(
            `INSERT INTO vehicles(id,company_id,${Object.keys(d).join(',')}) VALUES($1,$2,${values.map((_, i) => '$' + (i + 3)).join(',')})`,
            [id, u.company_id, ...values],
            db,
          );
          if (amount > 0) await db.query("UPDATE vehicles SET status='draft' WHERE id=$1", [id]);
          const [listingFee] = await q(
            `INSERT INTO vehicle_listing_fees(vehicle_id,company_id,amount_minor,status,reason)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,
            [
              id,
              u.company_id,
              amount,
              amount === 0 ? 'waived' : 'pending',
              amount === 0 ? 'first_vehicle' : 'additional_vehicle',
            ],
            db,
          );
          await audit(db, u, 'vehicle.created', id, { listingFeeMinor: amount });
          return { id, status: amount > 0 ? 'draft' : d.status, listingFee };
        },
      ),
    );
  }
  @Patch('vehicles/:id') async updateVehicle(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const u = user(req, ['owner']),
      d = vehicleSchema.partial().parse(body);
    requireCoordinatePair(d);
    if (!Object.keys(d).length) throw new BadRequestException();
    return tx(async (db) => {
      const [v] = await q('SELECT * FROM vehicles WHERE id=$1 FOR UPDATE', [id], db);
      if (!v) throw new NotFoundException();
      companyScope(u, v.company_id);
      if (d.city !== undefined && d.city !== v.city && d.lat === undefined && d.lng === undefined) {
        // Free text must not inherit the previous place's map point. A
        // selected suggestion explicitly supplies both new coordinates.
        d.lat = null;
        d.lng = null;
      }
      pickupCoordinates.parse({ lat: v.lat, lng: v.lng, ...d });
      if (d.status === 'published') {
        const [fee] = await q(
          'SELECT status FROM vehicle_listing_fees WHERE vehicle_id=$1 AND company_id=$2',
          [id, u.company_id],
          db,
        );
        if (fee?.status === 'pending')
          throw new ForbiddenException(
            'Przed publikacją rozlicz jednorazową opłatę 200 zł za dodanie pojazdu.',
          );
        const [c] = await q(
          'SELECT verified FROM companies WHERE id=$1 FOR SHARE',
          [u.company_id],
          db,
        );
        if (!c.verified) throw new ForbiddenException('Firma czeka na weryfikację.');
      }
      const values = Object.values(d).map((v) => (Array.isArray(v) ? JSON.stringify(v) : v));
      const [updated] = await q(
        `UPDATE vehicles SET ${Object.keys(d)
          .map((k, i) => `${k}=$${i + 1}`)
          .join(
            ',',
          )} WHERE id=$${values.length + 1} AND company_id=$${values.length + 2} RETURNING *`,
        [...values, id, u.company_id],
        db,
      );
      await audit(db, u, 'vehicle.updated', id, { fields: Object.keys(d) });
      return updated;
    });
  }
  @Post('blocks') async block(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req, ['owner']),
      d = z
        .object({
          vehicleId: z.string().min(1),
          start: dateSchema,
          end: dateSchema,
          reason: z.string().min(3).max(100),
        })
        .parse(body);
    if (d.end <= d.start)
      throw new BadRequestException('Koniec blokady musi być późniejszy od początku.');
    return tx(async (db) => {
      const [v] = await q('SELECT * FROM vehicles WHERE id=$1 FOR UPDATE', [d.vehicleId], db);
      if (!v) throw new NotFoundException();
      companyScope(u, v.company_id);
      await expireHolds(db);
      const [a] = await q(
        `INSERT INTO allocations(vehicle_id,company_id,occupied,reason) VALUES($1,$2,daterange($3::date,$4::date,'[)'),$5) RETURNING *`,
        [v.id, u.company_id, d.start, d.end, d.reason],
        db,
      );
      await audit(db, u, 'calendar.blocked', a.id, d);
      return a;
    });
  }
  @Delete('blocks/:id') async removeBlock(@Req() req: Authed, @Param('id') id: string) {
    const u = user(req, ['owner']);
    return tx(async (db) => {
      const [b] = await q(
        'SELECT * FROM allocations WHERE id=$1 AND booking_id IS NULL FOR UPDATE',
        [z.uuid().parse(id)],
        db,
      );
      if (!b) throw new NotFoundException();
      companyScope(u, b.company_id);
      await q('UPDATE allocations SET active=false WHERE id=$1', [id], db);
      await audit(db, u, 'calendar.unblocked', id);
      return { ok: true };
    });
  }
  @Get('stock') async stock(@Req() req: Authed, @Query() p: any) {
    const u = user(req, ['owner']);
    const start = p.start ? dateSchema.parse(p.start) : today(),
      end = p.end ? dateSchema.parse(p.end) : day(start, 7);
    if (end <= start) throw new BadRequestException('Sprawdź daty.');
    const [rows, usage, minimum] = await Promise.all([
      q(
        `SELECT s.*,ARRAY(SELECT sv.vehicle_id FROM stock_item_vehicles sv
        WHERE sv.company_id=s.company_id AND sv.item_id=s.id ORDER BY sv.vehicle_id) vehicle_ids,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id',sp.media_id,'asset','/api/v1/media/'||sp.media_id)
          ORDER BY sp.created_at,sp.media_id) FROM stock_item_photos sp
          WHERE sp.company_id=s.company_id AND sp.item_id=s.id),'[]'::jsonb) photos
        FROM stock_items s WHERE s.company_id=$1 ORDER BY s.active DESC,s.name,s.id`,
        [u.company_id],
      ),
      stockUsage(pool, u.company_id!, start, end),
      stockMinimum(pool, u.company_id!),
    ]);
    return rows.map((e) => {
      const reserved = usage.find((r) => r.item_id === e.id)?.used || 0;
      return {
        ...e,
        reserved,
        available: e.quantity - reserved,
        minimum_quantity: minimum.find((r) => r.item_id === e.id)?.needed || 0,
      };
    });
  }
  @Post('stock') async stockCreate(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req, ['owner']),
      d = stockSchema.parse(body);
    return tx(async (db) => {
      const id = 'stock-' + crypto.randomUUID();
      const vehicleIds = await resolveStockVehicles(
        db,
        u.company_id!,
        d.vehicleIds,
        d.excludedTypes,
      );
      const [created] = await q(
        `INSERT INTO stock_items(company_id,id,name,quantity,price,unit,excluded_types)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          u.company_id,
          id,
          d.name,
          d.quantity,
          d.price,
          d.unit,
          JSON.stringify(d.vehicleIds !== undefined ? [] : d.excludedTypes || []),
        ],
        db,
      );
      await saveStockVehicles(db, u.company_id!, id, vehicleIds);
      await audit(db, u, 'stock.created', id, { ...d, vehicleIds });
      return {
        ...created,
        vehicle_ids: vehicleIds,
        photos: [],
        reserved: 0,
        available: created.quantity,
        minimum_quantity: 0,
      };
    });
  }
  @Patch('stock/:id') async stockUpdate(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const u = user(req, ['owner']),
      d = stockPatchSchema.parse(body);
    return tx(async (db) => {
      const [s] = await q(
        'SELECT * FROM stock_items WHERE company_id=$1 AND id=$2 FOR UPDATE',
        [u.company_id, id],
        db,
      );
      if (!s) throw new NotFoundException();
      const [r] = await stockMinimum(db, u.company_id!, id);
      const needed = r?.needed || 0;
      if (d.quantity !== undefined && d.quantity < needed)
        throw new ConflictException(`W aktywnych rezerwacjach potrzeba co najmniej ${needed} szt.`);
      const { vehicleIds: selected, ...itemData } = d;
      if (selected !== undefined) itemData.excludedTypes = [];
      const changes = Object.entries(itemData).map(([key, value]) => [
        key === 'excludedTypes' ? 'excluded_types' : key,
        key === 'excludedTypes' ? JSON.stringify(value) : value,
      ]);
      const [updated] = await q(
        `UPDATE stock_items SET ${changes.map(([key], i) => `${key}=$${i + 1}`).join(',')}
          WHERE company_id=$${changes.length + 1} AND id=$${changes.length + 2} RETURNING *`,
        [...changes.map(([, value]) => value), u.company_id, id],
        db,
      );
      if (selected !== undefined || d.excludedTypes !== undefined) {
        const assigned = await resolveStockVehicles(db, u.company_id!, selected, d.excludedTypes);
        await saveStockVehicles(db, u.company_id!, id, assigned);
      }
      const assignments = await q(
        'SELECT vehicle_id FROM stock_item_vehicles WHERE company_id=$1 AND item_id=$2 ORDER BY vehicle_id',
        [u.company_id, id],
        db,
      );
      const vehicleIds = assignments.map((v) => v.vehicle_id);
      const photos = await q(
        `SELECT media_id id,'/api/v1/media/'||media_id asset FROM stock_item_photos
          WHERE company_id=$1 AND item_id=$2 ORDER BY created_at,media_id`,
        [u.company_id, id],
        db,
      );
      const action =
        d.active !== undefined && d.active !== s.active
          ? d.active
            ? 'stock.restored'
            : 'stock.archived'
          : 'stock.updated';
      await audit(db, u, action, id, { ...d, vehicleIds });
      return { ok: true, ...updated, vehicle_ids: vehicleIds, photos, minimum_quantity: needed };
    });
  }
  @Patch('settings') async settings(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req, ['owner']);
    const d = z
      .object({
        minDays: z.number().int().min(1).max(60),
        buffer: z.number().int().min(0).max(7),
        prep: z.number().int().min(0).max(1000000),
        open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .parse(body);
    return tx(async (db) => {
      await q(
        'UPDATE companies SET settings=$1 WHERE id=$2',
        [JSON.stringify(d), u.company_id],
        db,
      );
      await audit(db, u, 'company.settings', u.company_id!, d);
      return { ok: true };
    });
  }
  @Post('seasons') async season(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req, ['owner']);
    const d = z
      .object({
        name: z.string().min(2).max(80),
        vehicleId: z.string().nullable(),
        start: dateSchema,
        end: dateSchema,
        rate: z.number().int().min(100).max(1000000),
      })
      .parse(body);
    if (d.end <= d.start) throw new BadRequestException('Sprawdź daty sezonu.');
    return tx(async (db) => {
      if (d.vehicleId) {
        const [v] = await q('SELECT company_id FROM vehicles WHERE id=$1', [d.vehicleId], db);
        if (!v) throw new NotFoundException();
        companyScope(u, v.company_id);
      }
      const [s] = await q(
        'INSERT INTO seasons(company_id,vehicle_id,start_date,end_date,rate,name) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [u.company_id, d.vehicleId, d.start, d.end, d.rate, d.name],
        db,
      );
      await audit(db, u, 'season.created', s.id);
      return s;
    });
  }
  @Delete('seasons/:id') async deleteSeason(@Req() req: Authed, @Param('id') id: string) {
    const u = user(req, ['owner']);
    return tx(async (db) => {
      const [s] = await q(
        'DELETE FROM seasons WHERE id=$1 AND company_id=$2 RETURNING id',
        [z.uuid().parse(id), u.company_id],
        db,
      );
      if (!s) throw new NotFoundException();
      await audit(db, u, 'season.deleted', id);
      return { ok: true };
    });
  }
  @Patch('tasks/:id') async task(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const u = user(req, ['owner']),
      d = z.object({ done: z.boolean() }).parse(body);
    const [r] = await q('UPDATE tasks SET done=$1 WHERE id=$2 AND company_id=$3 RETURNING *', [
      d.done,
      z.uuid().parse(id),
      u.company_id,
    ]);
    if (!r) throw new NotFoundException();
    return r;
  }
  @Post('team') async team(@Req() req: Authed, @Body() body: unknown) {
    const u = user(req, ['owner']);
    const d = z
      .object({
        email: z.email().max(160),
        name: z.string().min(2).max(100),
        password: z.string().min(10).max(128),
      })
      .parse(body);
    return tx(async (db) => {
      const [r] = await q(
        `INSERT INTO users(email,name,password_hash,role,company_id) VALUES($1,$2,$3,'owner',$4) RETURNING id,name,email,role`,
        [d.email.toLowerCase(), d.name, await hash(d.password), u.company_id],
        db,
      );
      await audit(db, u, 'team.member_created', r.id);
      const [company] = await q('SELECT name FROM companies WHERE id=$1', [u.company_id], db);
      await notifyTeamMemberCreated(db, r.id, company.name);
      await requestEmailVerification(db, r, trustedRequestOrigin(req));
      return r;
    });
  }
}
