import { createHash } from 'node:crypto';

// Local synthetic activity. The caller owns the transaction and catalog data.
const DATASET = 'world-demo-v1';
const DAY = 86_400_000;
const ACTIVE = new Set(['pending', 'confirmed', 'in_rental']);
const uuid = (key) => {
  const h = createHash('sha256').update(`${DATASET}:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const date = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const day = (value, offset) =>
  new Date(Date.parse(`${date(value)}T12:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
const days = (a, b) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);
const stamp = (value, hour = 10, minute = 0) =>
  `${date(value)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`;
const json = (value) => JSON.stringify(value);
const label = 'Scenariusz demo';
const stripCommunicationPrefix = (value) =>
  value.replace(/^\s*Scenariusz demo\s*[:•]\s*/i, '');

async function insert(db, table, values) {
  const keys = Object.keys(values);
  return (
    await db.query(
      `INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT DO NOTHING`,
      Object.values(values),
    )
  ).rowCount;
}

async function audit(db, actor, action, resource, createdAt, details = {}) {
  await db.query(
    `INSERT INTO audit(user_id,company_id,action,resource,details,created_at)
     SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS(
       SELECT 1 FROM audit WHERE action=$3 AND resource=$4 AND details->>'demoDataset'=$7)`,
    [
      actor.id,
      actor.company_id || null,
      action,
      resource,
      json({ synthetic: true, demoDataset: DATASET, ...details }),
      createdAt,
      DATASET,
    ],
  );
}

async function mail(db, userId, subject, body, createdAt) {
  // Completed worker jobs and an outbox receipt show local delivery without SMTP.
  // Keep the original subject in the key so existing completed jobs remain idempotent.
  const demoKey = `${userId}:${subject}`;
  const cleanSubject = stripCommunicationPrefix(subject);
  const cleanBody = stripCommunicationPrefix(body);
  await db.query(
    `INSERT INTO local_mail(user_id,subject,body,created_at)
     SELECT $1,$2,$3,$4 WHERE NOT EXISTS(
       SELECT 1 FROM local_mail WHERE user_id=$1 AND subject=ANY($5::text[]))`,
    [userId, cleanSubject, cleanBody, createdAt, [subject, cleanSubject]],
  );
  await db.query(
    `INSERT INTO jobs(kind,payload,status,attempts,next_run,created_at)
     SELECT 'mail',$1,'done',1,$2,$2 WHERE NOT EXISTS(
       SELECT 1 FROM jobs WHERE kind='mail' AND payload->>'demoKey'=$3)`,
    [
      json({
        userId,
        subject: cleanSubject,
        body: cleanBody,
        synthetic: true,
        demoDataset: DATASET,
        demoKey,
      }),
      createdAt,
      demoKey,
    ],
  );
}

async function stockUsage(db, companyId, start, end, excludeBooking = null) {
  const { rows } = await db.query(
    `WITH relevant AS (
       SELECT e.item_id,e.quantity,greatest(b.start_date,$2::date) starts,least(b.end_date,$3::date) ends
       FROM booking_extras e JOIN bookings b ON b.id=e.booking_id
       WHERE e.company_id=$1 AND b.status IN('held','pending','confirmed','in_rental')
         AND (b.status!='held' OR b.hold_until>now()) AND b.start_date<$3::date AND b.end_date>$2::date
         AND ($4::uuid IS NULL OR b.id<>$4::uuid)
     ), events AS (SELECT item_id,starts dt,quantity delta FROM relevant UNION ALL SELECT item_id,ends,-quantity FROM relevant),
     daily AS(SELECT item_id,dt,sum(delta) delta FROM events GROUP BY item_id,dt),
     running AS(SELECT item_id,sum(delta) OVER(PARTITION BY item_id ORDER BY dt) used FROM daily)
     SELECT item_id,max(used)::int used FROM running GROUP BY item_id`,
    [companyId, start, end, excludeBooking],
  );
  return new Map(rows.map((r) => [r.item_id, r.used]));
}

async function clearPeriod(db, vehicle, company, start, end, excludeBooking = null) {
  const { rows } = await db.query(
    `SELECT id FROM allocations WHERE vehicle_id=$1 AND active
       AND occupied && daterange($2::date,$3::date+$4::integer,'[)')
       AND ($5::uuid IS NULL OR booking_id IS DISTINCT FROM $5::uuid) LIMIT 1`,
    [vehicle.id, start, end, Number(company.settings.buffer ?? 1), excludeBooking],
  );
  return rows.length === 0;
}

function snapshot(
  vehicle,
  company,
  seasons,
  stock,
  start,
  end,
  guests,
  selected,
  quotedOn,
  plan = 'deposit',
) {
  const count = days(start, end);
  const matchingSeasons = seasons
    .filter((s) => s.company_id === company.id && (!s.vehicle_id || s.vehicle_id === vehicle.id))
    .sort(
      (a, b) =>
        Number(Boolean(b.vehicle_id)) - Number(Boolean(a.vehicle_id)) ||
        date(b.start_date).localeCompare(date(a.start_date)),
    );
  const rates = Array.from({ length: count }, (_, i) => {
    const rentalDay = day(start, i);
    const season = matchingSeasons.find(
      (s) => date(s.start_date) <= rentalDay && date(s.end_date) > rentalDay,
    );
    return { date: rentalDay, rate: Number(season?.rate ?? vehicle.daily) };
  });
  const extras = Object.entries(selected).map(([id, quantity]) => {
    const item = stock.find((s) => s.id === id);
    return {
      id,
      name: item.name,
      quantity,
      price: Number(item.price),
      unit: item.unit,
      total: quantity * Number(item.price) * (item.unit === 'day' ? count : 1),
    };
  });
  const baseMinor = rates.reduce((n, r) => n + r.rate, 0);
  const prepMinor = Number(company.settings.prep ?? vehicle.prep);
  const equipmentMinor = extras.reduce((n, e) => n + e.total, 0);
  const totalMinor = baseMinor + prepMinor + equipmentMinor;
  const paymentPlan = days(quotedOn, start) < 7 ? 'full' : plan;
  return {
    vehicle: {
      ...vehicle,
      company_name: company.name,
      settings: company.settings,
      verified: company.verified,
    },
    days: count,
    rates,
    baseMinor,
    prepMinor,
    equipmentMinor,
    extras,
    totalMinor,
    depositMinor: Number(vehicle.deposit),
    buffer: Number(company.settings.buffer ?? 1),
    plan: paymentPlan,
    dueNowMinor: paymentPlan === 'deposit' ? Math.round(totalMinor * 0.3) : totalMinor,
    balanceDue: day(start, -7),
    currency: 'PLN',
    start,
    end,
    guests,
    synthetic: true,
    demoDataset: DATASET,
    scenarioLabel: label,
  };
}

const reviewTexts = [
  'Auto było czyste i gotowe na umówioną godzinę. Instruktaż obsługi ogrzewania i wody bardzo pomógł podczas pierwszej podróży.',
  'Udany wyjazd na Mazury. Wygodne łóżka, dobry kontakt z wypożyczalnią i sprawny zwrot bez pośpiechu.',
  'Cała rodzina zmieściła się wygodnie, a krzesła i stolik z magazynu uratowały wieczory na kempingu. Polecamy na tygodniowy wyjazd.',
  'Wyjazd w góry przebiegł spokojnie. Przy odbiorze wyjaśniono zasady parkowania i ładowania akumulatora. Chętnie wrócimy.',
  'Pojazd zgodny z opisem i sprawne rozliczenie. Przy odbiorze czekaliśmy kilkanaście minut, ale firma uprzedziła nas o opóźnieniu.',
  'W trakcie wyjazdu potrzebowaliśmy pomocy z obsługą lodówki. Odpowiedź przyszła szybko i problem udało się rozwiązać telefonicznie.',
];

function conversation(kind, b, vehicle, company, inventory) {
  const accessories =
    b.snapshot.extras.map((e) => e.name).join(', ') ||
    inventory
      .slice(0, 2)
      .map((e) => e.name)
      .join(', ');
  if (kind === 0)
    return [
      `Dzień dobry, mamy rezerwację ${b.reference} na ${b.start_date}–${b.end_date}. Czy przy odbiorze pokażą Państwo obsługę wody i ogrzewania?`,
      `Dzień dobry. Tak, przy odbiorze ${vehicle.name} przejdziemy razem pełny instruktaż i protokół. Prosimy przygotować dokument tożsamości i prawo jazdy.`,
      `Dziękuję. Czy wyposażenie dodatkowe (${accessories}) będzie już przygotowane w pojeździe?`,
      'Tak, przygotujemy zamówione wyposażenie i sprawdzimy je wspólnie na protokole. Pozostałe rzeczy z magazynu można dobrać po sprawdzeniu dostępności.',
      'Wróciliśmy z wyjazdu. Wszystko działało, chcielibyśmy potwierdzić przyjęcie protokołu zwrotu.',
      b.deposit_status === 'claim_pending'
        ? 'Protokół zwrotu jest zapisany. Wyjaśniamy drobne uszkodzenie wyposażenia; kaucja ma osobny status i wrócimy z dokumentacją sprawy. To wyłącznie scenariusz testowy.'
        : 'Potwierdzamy zapis protokołu zwrotu. Dziękujemy za podróż i zapraszamy do wystawienia opinii po zakończonym wynajmie. Rozliczenia w tym scenariuszu są testowe.',
    ];
  if (kind === 1)
    return [
      `Dzień dobry, pytam o ${vehicle.name} w terminie ${b.start_date}–${b.end_date}. Planujemy wyjazd w ${b.guests} osoby.`,
      `Dzień dobry, ${company.name} potwierdza ${vehicle.sleeps} miejsca do spania. ${b.status === 'pending' ? 'Zapytanie o rezerwację czeka na naszą decyzję.' : b.status === 'in_rental' ? 'Pojazd został już odebrany w ramach tego scenariusza.' : 'Rezerwacja jest potwierdzona.'}`,
      'Czy możemy zabrać psa? Zależy nam też na wyposażeniu do odpoczynku na zewnątrz.',
      vehicle.pets
        ? `W tej ofercie akceptujemy zwierzęta. Prosimy o własne posłanie i utrzymanie wnętrza w czystości. Wyposażenie z rezerwacji: ${accessories}.`
        : `Ten pojazd ma zasadę podróży bez zwierząt. Możemy pomóc znaleźć inną ofertę z filtrem „Zwierzęta”. Wyposażenie z rezerwacji: ${accessories}.`,
      'Rozumiem. Jakie są godziny odbioru i czy zadzwonić przed przyjazdem?',
      `Pracujemy ${company.settings.open || '09:00'}–${company.settings.close || '17:00'} w ${company.city}. Prosimy o wiadomość około 30 minut przed przyjazdem.`,
      'Dziękuję, sprawdzę szczegóły w rezerwacji i potwierdzę plan przyjazdu.',
      'Wszystkie ustalenia są widoczne w panelu podróżnika. W razie zmiany terminu prosimy wysłać propozycję zmiany z rezerwacji.',
    ];
  const base = [
    `Dzień dobry. Czy ${vehicle.name} można wynająć na wyjazd do Czech i Austrii? Chcemy dobrać dodatkowe wyposażenie.`,
    'Dzień dobry. Trasę zagraniczną uzgodnimy przed potwierdzeniem rezerwacji i sprawdzimy zakres dokumentów pojazdu. Prosimy wskazać planowane kraje i daty.',
    `Planujemy spokojną trasę przez Czechy, około 1200 km. Interesuje nas: ${accessories}.`,
    `Limit w tej ofercie: ${vehicle.km == null ? 'bez limitu kilometrów' : `${vehicle.km} km na dobę`}. Dostępność wyposażenia sprawdzamy dla wybranego terminu. Portal pokazuje usługi ubezpieczenia i winiet jako niepodłączone.`,
    'Czy w przypadku zmiany planów mogę poprosić o inny termin i zgłosić problem przez portal?',
    'Tak, propozycję zmiany wysyła się z rezerwacji przed odbiorem. Sprawy wymagające wyjaśnienia można przekazać w zakładce zgłoszeń; anulowanie i zwrot wpłaty mają osobne statusy.',
  ];
  if (['cancelled', 'rejected', 'expired'].includes(b.status))
    base.push(
      `Widzę, że wcześniejsza rezerwacja ${b.reference} ma status ${b.status === 'cancelled' ? 'anulowana' : b.status === 'rejected' ? 'odrzucona' : 'wygasła'}. Czy mogę rozpocząć nowe zapytanie?`,
      'Tak, wybierz nowy termin i sprawdź dostępność. Poprzednią historię zachowujemy w panelu, żeby można było prześledzić cały scenariusz.',
    );
  return base;
}

export async function populateWorldActivity(db, { companies, vehicles, travelers, owners, now }) {
  if (!companies.length || !vehicles.length || !travelers.length)
    throw new Error('Catalog and travelers must exist before populating world activity.');
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) throw new Error('A valid demo anchor date is required.');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(instant);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [DATASET]);
  const companyIds = companies.map((c) => c.id);
  // Match the API's vehicle → stock lock order, including manual calendar blocks.
  await db.query('SELECT id FROM vehicles WHERE id=ANY($1::text[]) ORDER BY id FOR NO KEY UPDATE', [
    vehicles.map((v) => v.id),
  ]);
  const stock = (
    await db.query(
      'SELECT * FROM stock_items WHERE company_id=ANY($1::text[]) ORDER BY company_id,id FOR UPDATE',
      [companyIds],
    )
  ).rows;
  const assignments = (
    await db.query('SELECT * FROM stock_item_vehicles WHERE company_id=ANY($1::text[])', [
      companyIds,
    ])
  ).rows;
  const assigned = new Set(assignments.map((s) => `${s.company_id}:${s.vehicle_id}:${s.item_id}`));
  const seasons = (
    await db.query(
      'SELECT s.*,start_date::text start_date,end_date::text end_date FROM seasons s WHERE company_id=ANY($1::text[])',
      [companyIds],
    )
  ).rows;
  const admin = (
    await db.query(
      "SELECT id,role,company_id FROM users WHERE role='admin' ORDER BY created_at,id LIMIT 1",
    )
  ).rows[0];
  if (!admin) throw new Error('A local administrator is required to record test refund history.');
  const ownerMap = new Map(owners.map((o) => [o.company_id, o]));
  const allBookings = [];
  const generated = {
    bookings: [],
    quotes: [],
    allocations: [],
    payments: [],
    services: [],
    handovers: [],
    comments: [],
    messages: [],
    reports: [],
    tasks: [],
    amendments: [],
  };
  const samples = [];
  let amendmentCount = 0;

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    const owner = ownerMap.get(company.id);
    if (!owner) throw new Error(`Missing owner for ${company.id}`);
    const cars = vehicles.filter((v) => v.company_id === company.id && v.status === 'published');
    const inventory = stock.filter((e) => e.company_id === company.id);
    if (!cars.length || !inventory.length)
      throw new Error(`Missing published vehicles or stock for ${company.id}`);
    const firmBookings = [];
    const slots = i < 50 ? 4 : 3;
    for (let slot = 0; slot < slots; slot++) {
      const id = uuid(`booking:${company.id}:${slot}`);
      const old = (
        await db.query(
          'SELECT b.*,start_date::text start_date,end_date::text end_date FROM bookings b WHERE id=$1',
          [id],
        )
      ).rows[0];
      if (old) {
        old.start_date = date(old.start_date);
        old.end_date = date(old.end_date);
        firmBookings.push(old);
        allBookings.push(old);
        continue;
      }
      const customer = travelers[(i * 3 + slot + (slot === 3 ? 450 : 0)) % travelers.length];
      let vehicle = cars[(i + slot) % cars.length];
      const minimum = Math.max(
        ...cars.map((v) => Number(v.min_days)),
        Number(company.settings.minDays || 2),
      );
      const length = Math.min(60, Math.max(minimum + 1, 4 + ((i + slot) % 7)));
      let status;
      let start;
      if (slot === 0) {
        status = 'completed';
        start = day(today, -48 - (i % 23));
      } else if (slot === 1) {
        status = i % 10 === 0 ? 'in_rental' : i % 3 === 0 ? 'pending' : 'confirmed';
        start = status === 'in_rental' ? day(today, -2) : day(today, 10 + (i % 29));
      } else if (slot === 2) {
        status = ['cancelled', 'rejected', 'expired', 'completed'][i % 4];
        start = day(today, status === 'completed' ? -95 - (i % 17) : 50 + (i % 19));
      } else {
        status = 'confirmed';
        start = day(today, 88 + (i % 17));
      }
      let end = day(start, length);
      if (ACTIVE.has(status)) {
        const manualDecisionCars = cars.filter((v) => !v.instant);
        if (status === 'pending' && !manualDecisionCars.length) status = 'confirmed';
        const preferredCars = [vehicle, ...cars.filter((v) => v.id !== vehicle.id)];
        const candidates =
          status === 'pending' ? preferredCars.filter((v) => !v.instant) : preferredCars;
        let free = false;
        for (let attempt = 0; attempt < 30 && !free; attempt++) {
          for (const candidate of candidates) {
            if (
              days(start, end) < Math.max(candidate.min_days, Number(company.settings.minDays || 2))
            )
              continue;
            if (await clearPeriod(db, candidate, company, start, end)) {
              vehicle = candidate;
              free = true;
              break;
            }
          }
          if (!free) {
            if (status === 'in_rental') status = 'confirmed';
            start = day(start < today ? today : start, 14);
            end = day(start, length);
          }
        }
        if (!free) throw new Error(`No conflict-free demo booking window for ${company.id}`);
      }
      const usage = ACTIVE.has(status) ? await stockUsage(db, company.id, start, end) : new Map();
      const usable = inventory.filter(
        (s) =>
          s.active &&
          assigned.has(`${company.id}:${vehicle.id}:${s.id}`) &&
          s.quantity - (usage.get(s.id) || 0) > 0,
      );
      const selected = {};
      for (let e = 0; e < Math.min(1 + ((i + slot) % 3), usable.length); e++) {
        const item = usable[(i + slot + e) % usable.length];
        selected[item.id] = 1;
      }
      const guests = Math.min(
        2 + (i % 3),
        vehicle.sleeps,
        vehicle.type === 'trailer' ? vehicle.sleeps : vehicle.seats,
      );
      const quotedOn = start < today ? day(start, -28) : day(today, -3 - (i % 10));
      const quote = snapshot(
        vehicle,
        company,
        seasons,
        inventory,
        start,
        end,
        guests,
        selected,
        quotedOn,
        (i + slot) % 5 === 0 ? 'full' : 'deposit',
      );
      // The accepted-change history starts with a shorter original rental.
      // Keep its immutable quote and first payment separate from the final quote.
      const acceptedAmendment =
        slot === 1 &&
        ['pending', 'confirmed'].includes(status) &&
        amendmentCount < 60 &&
        amendmentCount % 3 === 1;
      const originalEnd = acceptedAmendment ? day(end, -1) : end;
      const originalQuote = acceptedAmendment
        ? snapshot(
            vehicle,
            company,
            seasons,
            inventory,
            start,
            originalEnd,
            guests,
            selected,
            quotedOn,
            quote.plan,
          )
        : quote;
      const createdAt = stamp(quotedOn);
      const quoteId = uuid(`quote:${company.id}:${slot}`);
      const paymentInitial = status === 'expired' ? 0 : originalQuote.dueNowMinor;
      const refunded = ['cancelled', 'rejected'].includes(status) && Math.floor(i / 4) % 2 === 0;
      const paid =
        ['completed', 'in_rental'].includes(status) || (status === 'confirmed' && i % 4 === 0)
          ? quote.totalMinor
          : refunded
            ? 0
            : paymentInitial;
      const paymentStatus =
        status === 'expired'
          ? 'unpaid'
          : refunded
            ? 'refunded'
            : ['cancelled', 'rejected'].includes(status)
              ? 'refund_pending'
              : paid === quote.totalMinor
                ? 'paid'
                : 'partial';
      const depositStatus =
        status === 'completed'
          ? i % 17 === 0
            ? 'claim_pending'
            : 'released'
          : status === 'in_rental'
            ? 'authorized'
            : 'scheduled';
      const updatedAt = stamp(
        status === 'completed' ? day(end, 1) : status === 'in_rental' ? start : day(today, -2),
      );
      const booking = {
        id,
        reference: `VL-DEMO-${String(i + 1).padStart(3, '0')}-${slot + 1}`,
        user_id: customer.id,
        company_id: company.id,
        vehicle_id: vehicle.id,
        quote_id: quoteId,
        start_date: start,
        end_date: end,
        guests,
        status,
        hold_until: null,
        payment_status: paymentStatus,
        deposit_status: depositStatus,
        total_minor: quote.totalMinor,
        paid_minor: paid,
        deposit_minor: quote.depositMinor,
        buffer: quote.buffer,
        snapshot: quote,
        traveler: {
          name: customer.name,
          email: customer.email,
          phone: customer.profile?.phone || '',
          accept: true,
          note: [
            'rodzinny wyjazd na Mazury; prosimy o instruktaż obsługi wody.',
            'weekend w górach; odbiór w standardowych godzinach firmy.',
            'spokojna trasa kempingowa; wyposażenie zgodnie z rezerwacją.',
            'pierwsza podróż kamperem; prosimy o dodatkowy czas na instruktaż.',
          ][i % 4],
          synthetic: true,
          demoDataset: DATASET,
        },
        created_at: createdAt,
        updated_at: acceptedAmendment ? stamp(day(today, -1), 13) : updatedAt,
      };
      await insert(db, 'quotes', {
        id: quoteId,
        user_id: customer.id,
        vehicle_id: vehicle.id,
        input: json({
          vehicleId: vehicle.id,
          start,
          end: originalEnd,
          guests,
          extras: selected,
          plan: quote.plan,
        }),
        snapshot: json(originalQuote),
        created_at: createdAt,
        expires_at: new Date(Date.parse(createdAt) + 15 * 60_000).toISOString(),
      });
      await insert(db, 'bookings', {
        ...booking,
        snapshot: json(quote),
        traveler: json(booking.traveler),
      });
      generated.bookings.push(id);
      generated.quotes.push(quoteId);
      const allocationId = uuid(`allocation:${id}`);
      await db.query(
        `INSERT INTO allocations(id,vehicle_id,booking_id,company_id,occupied,active,reason,created_at)
         VALUES($1,$2,$3,$4,daterange($5::date,$6::date+$7::integer,'[)'),$8,$9,$10) ON CONFLICT(id) DO NOTHING`,
        [
          allocationId,
          vehicle.id,
          id,
          company.id,
          start,
          end,
          quote.buffer,
          ACTIVE.has(status),
          'rezerwacja',
          createdAt,
        ],
      );
      generated.allocations.push(allocationId);
      for (const extra of quote.extras)
        await insert(db, 'booking_extras', {
          booking_id: id,
          company_id: company.id,
          item_id: extra.id,
          quantity: extra.quantity,
          price: extra.price,
          unit: extra.unit,
        });
      if (paymentInitial > 0) {
        const paymentId = uuid(`payment:initial:${id}`);
        await insert(db, 'payments', {
          id: paymentId,
          booking_id: id,
          kind: 'payment',
          amount_minor: paymentInitial,
          provider: 'local_test',
          status: 'succeeded',
          idempotency_key: `${DATASET}:payment:${id}`,
          created_at: createdAt,
        });
        generated.payments.push(paymentId);
        await audit(db, customer, 'payment.local_test', id, createdAt, { amount: paymentInitial });
      }
      if (paid > paymentInitial) {
        const paymentId = uuid(`payment:balance:${id}`);
        const balanceAt = acceptedAmendment
          ? stamp(day(today, -1), 12)
          : stamp(day(start, -7) > today ? day(today, -1) : day(start, -7));
        await insert(db, 'payments', {
          id: paymentId,
          booking_id: id,
          kind: 'payment',
          amount_minor: paid - paymentInitial,
          provider: 'local_test',
          status: 'succeeded',
          idempotency_key: `${DATASET}:balance:${id}`,
          created_at: balanceAt,
        });
        generated.payments.push(paymentId);
        await audit(db, customer, 'payment.balance_test', id, balanceAt, {
          amount: paid - paymentInitial,
        });
      }
      if (refunded && paymentInitial > 0) {
        const paymentId = uuid(`payment:refund:${id}`);
        await insert(db, 'payments', {
          id: paymentId,
          booking_id: id,
          kind: 'refund',
          amount_minor: paymentInitial,
          provider: 'local_test',
          status: 'succeeded',
          idempotency_key: `${DATASET}:refund:${id}`,
          created_at: updatedAt,
        });
        generated.payments.push(paymentId);
        await audit(db, admin, 'payment.refund_test', id, updatedAt, { amount: paymentInitial });
      }
      for (const kind of ['insurance', 'vignette']) {
        const serviceId = uuid(`service:${kind}:${id}`);
        await insert(db, 'services', {
          id: serviceId,
          booking_id: id,
          kind,
          status: 'unavailable',
          details: json({
            synthetic: true,
            demoDataset: DATASET,
            label: `${label}: integracja niepodłączona`,
            provider: 'not_connected',
            destination: i % 3 === 0 ? 'Czechy' : 'Polska',
            externalPurchase: false,
          }),
          created_at: createdAt,
        });
        generated.services.push(serviceId);
      }
      const taskId = uuid(`task:prepare:${id}`);
      await insert(db, 'tasks', {
        id: taskId,
        company_id: company.id,
        booking_id: id,
        title: `Przygotuj ${vehicle.name}: ${start} • ${quote.extras.length ? quote.extras.map((e) => `${e.name} ×${e.quantity}`).join(', ') : 'wyposażenie standardowe'}`,
        done: ['completed', 'in_rental', 'cancelled', 'rejected', 'expired'].includes(status),
        created_at: createdAt,
      });
      generated.tasks.push(taskId);
      if (['completed', 'in_rental'].includes(status)) {
        const initialMileage = 22_000 + i * 337 + slot * 830;
        for (const kind of status === 'completed' ? ['pickup', 'return'] : ['pickup']) {
          const handoverId = uuid(`handover:${kind}:${id}`);
          const at = stamp(kind === 'pickup' ? start : end, kind === 'pickup' ? 9 : 15);
          await insert(db, 'handovers', {
            id: handoverId,
            booking_id: id,
            created_by: owner.id,
            kind,
            mileage: initialMileage + (kind === 'return' ? length * (110 + (i % 80)) : 0),
            fuel: 'Pełny',
            notes:
              kind === 'pickup'
                ? 'sprawdzono stan pojazdu, wyposażenie i instruktaż; wszystkie uwagi zapisane na protokole.'
                : depositStatus === 'claim_pending'
                  ? 'zgłoszono drobne uszkodzenie wyposażenia; sprawa wymaga osobnego wyjaśnienia kaucji.'
                  : 'pojazd zwrócony z pełnym paliwem; wyposażenie kompletne i sprawdzone.',
            checks: json({ equipment: true, condition: true, fuel: true }),
            confirmed: true,
            created_at: at,
          });
          generated.handovers.push(handoverId);
          await audit(db, owner, `handover.${kind}`, id, at);
        }
        await audit(db, owner, 'deposit.local_status', id, updatedAt, {
          status: depositStatus,
          reason: `${label}: testowe rozliczenie kaucji`,
        });
      }
      if (status === 'completed') {
        const commentId = uuid(`review:${id}`);
        const commentAt = stamp(day(end, 2), 12);
        const moderated = i % 13 === 0 ? 'pending' : 'published';
        await insert(db, 'comments', {
          id: commentId,
          vehicle_id: vehicle.id,
          author_id: customer.id,
          booking_id: id,
          type: 'review',
          text: reviewTexts[(i + slot) % reviewTexts.length],
          rating: i % 11 === 0 ? 3 : i % 3 === 0 ? 4 : 5,
          status: moderated,
          reply:
            moderated === 'published' && i % 2 === 0
              ? 'Dziękujemy za opinię po zakończonym wyjeździe. Cieszymy się, że instruktaż i wyposażenie były przydatne.'
              : null,
          reply_by: moderated === 'published' && i % 2 === 0 ? owner.id : null,
          reason:
            moderated === 'published' ? 'opinia po własnym zakończonym wynajmie.' : null,
          created_at: commentAt,
        });
        generated.comments.push(commentId);
        await audit(db, customer, 'review.created', commentId, commentAt);
      }
      if (['cancelled', 'rejected'].includes(status))
        await audit(
          db,
          owner,
          status === 'cancelled' ? 'booking.cancelled' : 'booking.rejected',
          id,
          updatedAt,
        );
      if (status === 'confirmed') await audit(db, owner, 'booking.accepted', id, updatedAt);
      await mail(
        db,
        customer.id,
        `${label} • rezerwacja ${booking.reference}`,
        `Przykładowy wynajem ${vehicle.name}: ${start}–${end}. Status rezerwacji: ${status}; płatność: ${paymentStatus}. Wszystkie kwoty i wpłaty są fikcyjne; nie pobrano rzeczywistych pieniędzy.`,
        updatedAt,
      );
      firmBookings.push(booking);
      allBookings.push(booking);
    }

    for (let thread = 0; thread < 3; thread++) {
      const booking = firmBookings[thread];
      const vehicle = cars.find((v) => v.id === booking.vehicle_id);
      const customer = travelers.find((t) => t.id === booking.user_id);
      const messages = conversation(thread, booking, vehicle, company, inventory);
      const firstDay = thread === 0 ? day(booking.start_date, -2) : day(today, -1);
      for (let m = 0; m < messages.length; m++) {
        const messageId = uuid(`message:${company.id}:${thread}:${m}`);
        // The return exchange follows the real demo handover, rather than pickup.
        const messageDay = thread === 0 && m >= 4 ? day(booking.end_date, 1) : firstDay;
        await insert(db, 'messages', {
          id: messageId,
          vehicle_id: vehicle.id,
          traveler_id: customer.id,
          author_id: m % 2 === 0 ? customer.id : owner.id,
          text: messages[m],
          created_at: stamp(messageDay, 9 + Math.floor(m / 2), (m % 2) * 17),
        });
        generated.messages.push(messageId);
      }
      await mail(
        db,
        customer.id,
        `${label} • odpowiedź ${company.name} • ${thread + 1}`,
        `Nowa przykładowa odpowiedź w rozmowie o ${vehicle.name}. ${messages[1]}`,
        stamp(thread === 0 ? day(booking.end_date, 1) : firstDay, 14),
      );
    }

    for (const vehicle of cars) {
      for (let question = 0; question < 2; question++) {
        const commentId = uuid(`question:${vehicle.id}:${question}`);
        const customer = travelers[(i * 11 + question + cars.indexOf(vehicle)) % travelers.length];
        const text =
          question === 0
            ? `Czy w ${vehicle.name} jest instruktaż obsługi ogrzewania i zbiornika wody dla osób, które pierwszy raz wynajmują kampera?`
            : `Czy można dobrać wyposażenie z magazynu na rodzinny wyjazd i odebrać ${vehicle.name} w godzinach ${company.settings.open || '09:00'}–${company.settings.close || '17:00'}?`;
        const published = question === 0 || i % 3 !== 0;
        await insert(db, 'comments', {
          id: commentId,
          vehicle_id: vehicle.id,
          author_id: customer.id,
          booking_id: null,
          type: 'question',
          text,
          rating: null,
          status: published ? 'published' : 'pending',
          reply: published
            ? question === 0
              ? 'Tak, przy wydaniu przeprowadzamy instruktaż i sprawdzamy wszystkie ustalenia na protokole odbioru.'
              : 'Tak, wyposażenie wybiera się w ofercie. Jego dostępność zależy od wybranego terminu; godziny odbioru potwierdzamy w wiadomościach.'
            : null,
          reply_by: published ? owner.id : null,
          reason: published ? 'przykładowe pytanie do oferty.' : null,
          created_at: stamp(day(today, -2 - ((i + question) % 15)), 12),
        });
        generated.comments.push(commentId);
        await audit(
          db,
          customer,
          'question.created',
          commentId,
          stamp(day(today, -2 - ((i + question) % 15)), 12),
        );
      }
    }

    if (i < 100) {
      const booking = firmBookings[0];
      const customer = travelers.find((t) => t.id === booking.user_id);
      const reportId = uuid(`report:${company.id}`);
      const reportStatus = ['open', 'in_progress', 'resolved'][i % 3];
      const reportKinds = [
        [
          'Wyjaśnienie rozliczenia kaucji',
          'Prosimy o wyjaśnienie statusu kaucji po zwrocie pojazdu i potwierdzenie informacji zapisanych na protokole.',
        ],
        [
          'Uwagi do wyposażenia po wyjeździe',
          'Podczas wyjazdu zauważyliśmy problem z zamkiem schowka. Zapisaliśmy uwagę na protokole zwrotu i prosimy o potwierdzenie przyjęcia.',
        ],
        [
          'Podsumowanie rozliczenia rezerwacji',
          'Chcielibyśmy otrzymać czytelne podsumowanie testowej wpłaty oraz wyposażenia dodatkowego przypisanego do naszego zakończonego wynajmu.',
        ],
        [
          'Pomoc w potwierdzeniu protokołu',
          'Protokół zwrotu jest już widoczny, prosimy o sprawdzenie, czy potwierdzenie klienta zapisało się poprawnie.',
        ],
      ];
      const [subject, description] = reportKinds[i % reportKinds.length];
      const resolution =
        reportStatus === 'resolved'
          ? 'sprawdzono historię rezerwacji i protokoły. Informacje przekazano klientowi; sprawa zamknięta w lokalnym scenariuszu.'
          : reportStatus === 'in_progress'
            ? 'operator analizuje dokumenty i czeka na odpowiedź wypożyczalni.'
            : null;
      const reportAt = stamp(day(booking.end_date, 2), 13);
      await insert(db, 'reports', {
        id: reportId,
        user_id: customer.id,
        booking_id: booking.id,
        comment_id: null,
        subject,
        description: `${description} Rezerwacja ${booking.reference}.`,
        status: reportStatus,
        resolution,
        created_at: reportAt,
      });
      generated.reports.push(reportId);
      await audit(db, customer, 'report.created', reportId, reportAt);
      if (resolution)
        await mail(
          db,
          customer.id,
          `${label} • aktualizacja zgłoszenia • ${booking.reference}`,
          resolution,
          stamp(day(booking.end_date, 3), 14),
        );
      const taskId = uuid(`task:report:${company.id}`);
      await insert(db, 'tasks', {
        id: taskId,
        company_id: company.id,
        booking_id: booking.id,
        title: `Wyjaśnij zgłoszenie: ${subject} • ${booking.reference}`,
        done: reportStatus === 'resolved',
        created_at: reportAt,
      });
      generated.tasks.push(taskId);
    }

    const activeBooking = firmBookings[1];
    if (amendmentCount < 60 && ['pending', 'confirmed'].includes(activeBooking.status)) {
      const n = amendmentCount++;
      const amendmentId = uuid(`amendment:${activeBooking.id}`);
      const amendmentStatus = ['pending', 'accepted', 'rejected'][n % 3];
      const vehicle = cars.find((v) => v.id === activeBooking.vehicle_id);
      const proposedEnd =
        amendmentStatus === 'accepted'
          ? date(activeBooking.end_date)
          : day(activeBooking.end_date, 1);
      if (
        await clearPeriod(
          db,
          vehicle,
          company,
          date(activeBooking.start_date),
          proposedEnd,
          activeBooking.id,
        )
      ) {
        const chosen = Object.fromEntries(
          activeBooking.snapshot.extras.map((e) => [e.id, e.quantity]),
        );
        const usage = await stockUsage(
          db,
          company.id,
          date(activeBooking.start_date),
          proposedEnd,
          activeBooking.id,
        );
        if (
          Object.entries(chosen).every(
            ([id, quantity]) =>
              inventory.find((s) => s.id === id).quantity - (usage.get(id) || 0) >= quantity,
          )
        ) {
          const quote = snapshot(
            vehicle,
            company,
            seasons,
            inventory,
            date(activeBooking.start_date),
            proposedEnd,
            activeBooking.guests,
            chosen,
            today,
            activeBooking.snapshot.plan,
          );
          const previousEnd =
            amendmentStatus === 'accepted'
              ? day(activeBooking.end_date, -1)
              : date(activeBooking.end_date);
          const previousQuote = snapshot(
            vehicle,
            company,
            seasons,
            inventory,
            date(activeBooking.start_date),
            previousEnd,
            activeBooking.guests,
            chosen,
            date(activeBooking.created_at),
            activeBooking.snapshot.plan,
          );
          await insert(db, 'amendments', {
            id: amendmentId,
            booking_id: activeBooking.id,
            requested_by: activeBooking.user_id,
            input: json({
              vehicleId: vehicle.id,
              start: date(activeBooking.start_date),
              end: proposedEnd,
              guests: activeBooking.guests,
              extras: chosen,
              plan: quote.plan,
              note: 'prosimy o dodatkową dobę na spokojny powrót z wyjazdu.',
            }),
            snapshot: json(quote),
            previous:
              amendmentStatus === 'pending'
                ? null
                : json({
                    start: date(activeBooking.start_date),
                    end: previousEnd,
                    totalMinor: previousQuote.totalMinor,
                    snapshot: previousQuote,
                  }),
            status: amendmentStatus,
            created_at: stamp(day(today, -1), 8),
          });
          generated.amendments.push(amendmentId);
          await audit(
            db,
            { id: activeBooking.user_id },
            'booking.amendment_requested',
            activeBooking.id,
            stamp(day(today, -1), 8),
            { amendment: amendmentId },
          );
          if (amendmentStatus !== 'pending')
            await audit(
              db,
              owner,
              `booking.amendment_${amendmentStatus}`,
              activeBooking.id,
              stamp(day(today, -1), 11),
              { amendment: amendmentId },
            );
        }
      }
    }

    if (i % 10 === 0) {
      const vehicle = cars[0];
      const blockStart = day(today, 160 + i);
      const blockEnd = day(blockStart, 3);
      const blockId = uuid(`block:service:${company.id}`);
      const exists = (await db.query('SELECT id FROM allocations WHERE id=$1', [blockId])).rowCount;
      if (exists || (await clearPeriod(db, vehicle, company, blockStart, blockEnd))) {
        await db.query(
          `INSERT INTO allocations(id,vehicle_id,company_id,occupied,active,reason,created_at)
          VALUES($1,$2,$3,daterange($4::date,$5::date,'[)'),true,$6,$7) ON CONFLICT(id) DO NOTHING`,
          [
            blockId,
            vehicle.id,
            company.id,
            blockStart,
            blockEnd,
            'serwis okresowy i przegląd wyposażenia',
            stamp(day(today, -2)),
          ],
        );
        generated.allocations.push(blockId);
        await audit(db, owner, 'calendar.blocked', blockId, stamp(day(today, -2)), {
          start: blockStart,
          end: blockEnd,
        });
      }
    }
  }

  for (let i = 0; i < travelers.length; i++) {
    const count = 1 + (i % 4);
    for (let f = 0; f < count; f++) {
      const vehicle = vehicles[(i * 7 + f * 31) % vehicles.length];
      await insert(db, 'favorites', { user_id: travelers[i].id, vehicle_id: vehicle.id });
    }
  }

  // Count the entire dataset rather than only this invocation's inserts.
  const bookingIds = allBookings.map((b) => b.id);
  const activityCounts = {};
  const tableQueries = {
    bookings: ['SELECT count(*)::int n FROM bookings WHERE id=ANY($1::uuid[])', bookingIds],
    quotes: [
      'SELECT count(*)::int n FROM quotes WHERE id IN(SELECT quote_id FROM bookings WHERE id=ANY($1::uuid[]))',
      bookingIds,
    ],
    allocations: [
      'SELECT count(*)::int n FROM allocations WHERE booking_id=ANY($1::uuid[]) OR id=ANY($2::uuid[])',
      bookingIds,
      generated.allocations,
    ],
    payments: ['SELECT count(*)::int n FROM payments WHERE booking_id=ANY($1::uuid[])', bookingIds],
    services: ['SELECT count(*)::int n FROM services WHERE booking_id=ANY($1::uuid[])', bookingIds],
    handovers: [
      'SELECT count(*)::int n FROM handovers WHERE booking_id=ANY($1::uuid[])',
      bookingIds,
    ],
    reviews: [
      "SELECT count(*)::int n FROM comments WHERE type='review' AND booking_id=ANY($1::uuid[])",
      bookingIds,
    ],
    questions: [
      "SELECT count(*)::int n FROM comments WHERE type='question' AND id=ANY($1::uuid[])",
      generated.comments,
    ],
    messages: ['SELECT count(*)::int n FROM messages WHERE id=ANY($1::uuid[])', generated.messages],
    reports: ['SELECT count(*)::int n FROM reports WHERE id=ANY($1::uuid[])', generated.reports],
    tasks: ['SELECT count(*)::int n FROM tasks WHERE booking_id=ANY($1::uuid[])', bookingIds],
    amendments: [
      'SELECT count(*)::int n FROM amendments WHERE booking_id=ANY($1::uuid[])',
      bookingIds,
    ],
    favorites: [
      'SELECT count(*)::int n FROM favorites WHERE user_id=ANY($1::uuid[]) AND vehicle_id=ANY($2::text[])',
      travelers.map((t) => t.id),
      vehicles.map((v) => v.id),
    ],
    localMail: [
      `SELECT count(*)::int n FROM local_mail m WHERE m.user_id=ANY($1::uuid[]) AND EXISTS(
         SELECT 1 FROM jobs j WHERE j.kind='mail' AND j.payload->>'demoDataset'=$2
           AND j.payload->>'userId'=m.user_id::text
           AND (j.payload->>'subject'=m.subject
             OR j.payload->>'demoKey'=m.user_id::text||':'||m.subject
             OR j.payload->>'demoKey'=m.user_id::text||':'||$3||' • '||m.subject))`,
      travelers.map((t) => t.id),
      DATASET,
      label,
    ],
    mailJobs: ["SELECT count(*)::int n FROM jobs WHERE payload->>'demoDataset'=$1", DATASET],
    auditEvents: ["SELECT count(*)::int n FROM audit WHERE details->>'demoDataset'=$1", DATASET],
  };
  for (const [table, [query, ...args]] of Object.entries(tableQueries))
    activityCounts[table] = (await db.query(query, args)).rows[0].n;
  activityCounts.conversations = companies.length * 3;
  activityCounts.bookingStatuses = Object.fromEntries(
    (
      await db.query(
        'SELECT status,count(*)::int n FROM bookings WHERE id=ANY($1::uuid[]) GROUP BY status ORDER BY status',
        [bookingIds],
      )
    ).rows.map((r) => [r.status, r.n]),
  );
  const scenarioInstructions = {
    completed:
      'Zaloguj klienta i otwórz zakończony wyjazd: protokoły, rozliczenie kaucji, opinię oraz zgłoszenie. W Wiadomościach wybierz wskazany pojazd.',
    in_rental:
      'Zobacz trwający wynajem i zapisany protokół odbioru. Konto właściciela może przeglądać wyposażenie i przygotować protokół zwrotu.',
    cancelled:
      'Zobacz anulowaną rezerwację i osobny stan zwrotu testowej wpłaty. Historia rozmowy pozostała w Wiadomościach.',
    confirmed:
      'Zobacz potwierdzony wyjazd, dodatkowe wyposażenie i testową wpłatę. Właściciel ma rezerwację w kalendarzu oraz zadanie przygotowania.',
    rejected:
      'Zobacz odrzucone zapytanie o rezerwację i rozliczenie testowej wpłaty. Termin nie blokuje dostępności auta.',
    expired:
      'Zobacz wygasłą, nieopłaconą rezerwację oraz zachowaną rozmowę z wypożyczalnią. Termin nie blokuje dostępności.',
    pending:
      'Zaloguj właściciela i zobacz zapytanie czekające na decyzję; klient ma historię wiadomości i podsumowanie wyposażenia.',
  };
  for (const status of Object.keys(scenarioInstructions)) {
    const booking = allBookings.find((b) => b.status === status && !b.reference.endsWith('-4'));
    if (!booking) continue;
    const customer = travelers.find((t) => t.id === booking.user_id);
    const owner = ownerMap.get(booking.company_id);
    const company = companies.find((c) => c.id === booking.company_id);
    const vehicle = vehicles.find((v) => v.id === booking.vehicle_id);
    samples.push({
      title: `${label}: ${status}`,
      status,
      booking_id: booking.id,
      reference: booking.reference,
      traveler_id: customer.id,
      traveler_email: customer.email,
      owner_id: owner.id,
      owner_email: owner.email,
      company_id: company.id,
      company_name: company.name,
      vehicle_id: vehicle.id,
      vehicle_name: vehicle.name,
      booking_url: `https://vanly.me.local/konto/rezerwacja/${booking.id}`,
      conversation_url: 'https://vanly.me.local/konto/wiadomosci',
      owner_booking_url: `https://owner.vanly.me.local/firma/rezerwacja/${booking.id}`,
      owner_conversation_url: 'https://owner.vanly.me.local/firma/wiadomosci',
      instructions: scenarioInstructions[status],
    });
  }
  return { activityCounts, sampleScenarios: samples, demoDataset: DATASET, anchorDate: today };
}

// Explicit one-time repair for an earlier version of this synthetic dataset.
// The caller must own a transaction. This is never called by the importer.
export async function repairWorldDemoHistory(db) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [DATASET]);
  const admin = (
    await db.query(
      "SELECT id,role,company_id FROM users WHERE role='admin' ORDER BY created_at,id LIMIT 1",
    )
  ).rows[0];
  if (!admin) throw new Error('A local administrator is required to repair test refund history.');
  const refundAuditActors = (
    await db.query(
      `UPDATE audit SET user_id=$1,company_id=NULL WHERE action='payment.refund_test'
      AND details->>'demoDataset'=$2 AND user_id IS DISTINCT FROM $1`,
      [admin.id, DATASET],
    )
  ).rowCount;
  const candidates = (
    await db.query(
      `SELECT b.*,a.previous,a.created_at amendment_created_at,q.input original_input,q.snapshot original_snapshot
     FROM bookings b JOIN amendments a ON a.booking_id=b.id JOIN quotes q ON q.id=b.quote_id
     WHERE b.snapshot->>'demoDataset'=$1 AND b.reference LIKE 'VL-DEMO-%'
       AND a.status='accepted' AND b.status IN('pending','confirmed')
     ORDER BY b.id FOR UPDATE OF b,a,q`,
      [DATASET],
    )
  ).rows;
  const result = {
    refundAuditActors,
    acceptedBookingHistories: 0,
    paymentsAdded: 0,
    skippedBookings: [],
  };
  for (const b of candidates) {
    const previous = b.previous?.snapshot;
    if (!previous?.synthetic || previous.demoDataset !== DATASET)
      throw new Error(`Missing synthetic original quote for ${b.id}`);
    const payments = (
      await db.query('SELECT * FROM payments WHERE booking_id=$1 ORDER BY created_at FOR UPDATE', [
        b.id,
      ])
    ).rows;
    // Preserve any payment or status changes made interactively after import.
    const initial = payments.find((p) => p.idempotency_key === `${DATASET}:payment:${b.id}`);
    const balance = payments.find((p) => p.idempotency_key === `${DATASET}:balance:${b.id}`);
    if (
      !initial ||
      payments.some((p) => p.provider !== 'local_test' || ![initial.id, balance?.id].includes(p.id))
    ) {
      result.skippedBookings.push(b.id);
      continue;
    }
    const currentNet = payments.reduce(
      (n, p) => n + (p.kind === 'refund' ? -p.amount_minor : p.amount_minor),
      0,
    );
    if (currentNet !== b.paid_minor)
      throw new Error(`Existing synthetic payment ledger is inconsistent for ${b.id}`);
    const initialAmount = previous.dueNowMinor;
    const targetPaid = b.paid_minor === b.total_minor ? b.total_minor : initialAmount;
    const balanceAmount = targetPaid - initialAmount;
    if (initialAmount <= 0 || balanceAmount < 0 || (balanceAmount === 0 && balance))
      throw new Error(`Invalid synthetic amendment payment history for ${b.id}`);
    const originalInput = {
      ...b.original_input,
      start: previous.start,
      end: previous.end,
      guests: previous.guests,
      extras: Object.fromEntries(previous.extras.map((e) => [e.id, e.quantity])),
      plan: previous.plan,
    };
    const amendmentDay = date(b.amendment_created_at);
    const balanceAt = stamp(amendmentDay, 12);
    const updatedAt =
      new Date(b.updated_at).getTime() > Date.parse(stamp(amendmentDay, 13))
        ? new Date(b.updated_at).toISOString()
        : stamp(amendmentDay, 13);
    await db.query('UPDATE quotes SET input=$2,snapshot=$3 WHERE id=$1', [
      b.quote_id,
      json(originalInput),
      json(previous),
    ]);
    await db.query('UPDATE payments SET amount_minor=$2 WHERE id=$1', [initial.id, initialAmount]);
    await db.query(
      `UPDATE audit SET details=jsonb_set(details,'{amount}',$3::jsonb)
       WHERE resource=$1 AND action='payment.local_test' AND details->>'demoDataset'=$2`,
      [b.id, DATASET, json(initialAmount)],
    );
    if (balanceAmount > 0) {
      if (balance)
        await db.query('UPDATE payments SET amount_minor=$2,created_at=$3 WHERE id=$1', [
          balance.id,
          balanceAmount,
          balanceAt,
        ]);
      else
        result.paymentsAdded += await insert(db, 'payments', {
          id: uuid(`payment:balance:${b.id}`),
          booking_id: b.id,
          kind: 'payment',
          amount_minor: balanceAmount,
          provider: 'local_test',
          status: 'succeeded',
          idempotency_key: `${DATASET}:balance:${b.id}`,
          created_at: balanceAt,
        });
      await audit(db, { id: b.user_id }, 'payment.balance_test', b.id, balanceAt, {
        amount: balanceAmount,
      });
      await db.query(
        `UPDATE audit SET details=jsonb_set(details,'{amount}',$3::jsonb),created_at=$4
         WHERE resource=$1 AND action='payment.balance_test' AND details->>'demoDataset'=$2`,
        [b.id, DATASET, json(balanceAmount), balanceAt],
      );
    }
    await db.query(
      'UPDATE bookings SET paid_minor=$2,payment_status=$3,updated_at=$4 WHERE id=$1',
      [b.id, targetPaid, targetPaid === b.total_minor ? 'paid' : 'partial', updatedAt],
    );
    const net = (
      await db.query(
        "SELECT coalesce(sum(CASE WHEN kind='refund' THEN -amount_minor ELSE amount_minor END),0)::int n FROM payments WHERE booking_id=$1",
        [b.id],
      )
    ).rows[0].n;
    if (net !== targetPaid)
      throw new Error(`Repaired synthetic payment ledger is inconsistent for ${b.id}`);
    result.acceptedBookingHistories++;
  }
  return result;
}
