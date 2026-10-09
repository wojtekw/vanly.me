import { createHash } from 'node:crypto';
import {
  loadNotificationConfig,
  localDay,
  localHour,
  calendarDate,
  distanceDays,
} from './config.mjs';
import { transaction, enqueueEvent, genericNotice } from './repository.mjs';
const money = (minor) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(minor / 100);
const formattedDate = (day) =>
  new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeZone: 'Europe/Warsaw' }).format(
    new Date(day + 'T12:00:00Z'),
  );
const url = (config, path) => new URL(path, config.appUrl).href;
// Only proven local completions can stop counting towards an SES cooldown.
// Deleted jobs and uncertain/external attempts keep blocking new reminders.
const completedLocalDelivery = `EXISTS(
  SELECT 1 FROM jobs j JOIN mail_deliveries d ON d.job_id=j.id AND d.attempt=j.attempts
  WHERE j.id=e.job_id AND j.status='done' AND j.provider='local'
    AND d.provider='local' AND d.status='local'
    AND NOT EXISTS(SELECT 1 FROM mail_deliveries external
      WHERE external.job_id=j.id AND external.provider='ses'))`;

export class ReminderProducer {
  constructor(pool, { config = loadNotificationConfig(), now = () => new Date() } = {}) {
    this.pool = pool;
    this.config = config;
    this.now = now;
  }
  async tick() {
    if (!this.config.enabled) return { queued: 0 };
    const now = this.now(),
      today = localDay(now);
    const jobs = await transaction(this.pool, async (db) => {
      const queued = [];
      if (localHour(now) >= this.config.sendHour) {
        const expiry = (
          await db.query(
            "SELECT (($1::date+1)::timestamp AT TIME ZONE 'Europe/Warsaw') AS expires_at",
            [today],
          )
        ).rows[0].expires_at.toISOString();
        const candidates = (
          await db.query(
            `SELECT b.*,v.name vehicle_name,c.name company_name,
          EXISTS(SELECT 1 FROM payments p WHERE p.booking_id=b.id AND p.provider='local_test') AS test_payment,
          (SELECT max(created_at) FROM handovers h WHERE h.booking_id=b.id AND h.kind='return') AS returned_at,
          EXISTS(SELECT 1 FROM comments r WHERE r.booking_id=b.id AND r.author_id=b.user_id AND r.type='review') AS reviewed
          FROM bookings b JOIN vehicles v ON v.id=b.vehicle_id JOIN companies c ON c.id=b.company_id
          WHERE b.created_at >= $1 AND b.status IN('confirmed','in_rental','completed')
            AND (
              (b.status='confirmed' AND b.start_date=$2::date+1 AND NOT EXISTS(SELECT 1 FROM notification_events e
                WHERE e.recipient_user_id=b.user_id AND e.event_key='reminder.pickup:'||b.id::text||':'||b.start_date::text))
              OR (b.status='in_rental' AND b.end_date=$2::date+1 AND NOT EXISTS(SELECT 1 FROM notification_events e
                WHERE e.recipient_user_id=b.user_id AND e.event_key='reminder.return:'||b.id::text||':'||b.end_date::text))
              OR (b.status='completed' AND EXISTS(SELECT 1 FROM handovers h WHERE h.booking_id=b.id AND h.kind='return'
                AND (h.created_at AT TIME ZONE 'Europe/Warsaw')::date=$2::date-2)
                AND NOT EXISTS(SELECT 1 FROM comments r WHERE r.booking_id=b.id AND r.author_id=b.user_id AND r.type='review')
                AND NOT EXISTS(SELECT 1 FROM notification_events e WHERE e.recipient_user_id=b.user_id AND e.event_key='reminder.review:'||b.id::text))
              OR (b.status='confirmed' AND COALESCE(b.snapshot->>'settlementMode','local_test')!='direct' AND b.total_minor>b.paid_minor AND b.payment_status IN('partial','unpaid')
                AND b.snapshot->>'balanceDue' IN(($2::date+7)::text,($2::date+3)::text,($2::date+1)::text)
                AND NOT EXISTS(SELECT 1 FROM notification_events e WHERE e.recipient_user_id=b.user_id
                  AND e.event_key='reminder.balance:'||b.id::text||':'||(b.snapshot->>'balanceDue')||':'||
                    CASE WHEN b.snapshot->>'balanceDue'=($2::date+7)::text THEN '7'
                      WHEN b.snapshot->>'balanceDue'=($2::date+3)::text THEN '3' ELSE '1' END))
            )
          ORDER BY b.created_at LIMIT $3 FOR UPDATE OF b SKIP LOCKED`,
            [this.config.startAfter, today, this.config.batchSize],
          )
        ).rows;
        for (const b of candidates) {
          const start =
            typeof b.start_date === 'string' ? b.start_date.slice(0, 10) : localDay(b.start_date);
          const end =
            typeof b.end_date === 'string' ? b.end_date.slice(0, 10) : localDay(b.end_date);
          const base = `Pojazd: ${b.vehicle_name}\nWypożyczalnia: ${b.company_name}\nTermin: ${formattedDate(start)} – ${formattedDate(end)}`;
          const due = calendarDate(b.snapshot?.balanceDue);
          const balance = b.total_minor - b.paid_minor;
          const common = { expiresAt: expiry };
          const create = async (key, kind, subject, intro, details, next, guard = {}) => {
            const id = await enqueueEvent(
              db,
              b.user_id,
              key,
              genericNotice(
                subject,
                intro,
                details,
                next,
                url(this.config, '/konto/rezerwacja/' + b.id),
                { ...common, notificationGuard: { kind, bookingId: b.id, ...guard } },
              ),
              now,
            );
            if (id) queued.push(id);
          };
          if (
            b.status === 'confirmed' &&
            b.snapshot?.settlementMode !== 'direct' &&
            balance > 0 &&
            ['partial', 'unpaid'].includes(b.payment_status) &&
            due
          ) {
            const days = distanceDays(today, due);
            if ([7, 3, 1].includes(days))
              await create(
                `reminder.balance:${b.id}:${due}:${days}`,
                'balance',
                `Przypomnienie o dopłacie — ${b.reference}`,
                `Termin dopłaty za wyjazd przypada ${formattedDate(due)}.`,
                `${base}\nCena najmu: ${money(b.total_minor)}\nZapisane wpłaty: ${money(b.paid_minor)}\nPozostało: ${money(balance)}\nKaucja, oddzielnie: ${money(b.deposit_minor)}`,
                b.test_payment
                  ? 'Płatności w tej wersji są testowe. Dopłata w portalu nie pobiera rzeczywistych pieniędzy.'
                  : 'Sprawdź aktualną kwotę i dostępne sposoby płatności w portalu.',
                { dueDate: due, days, totalMinor: b.total_minor, paidMinor: b.paid_minor },
              );
          }
          if (b.status === 'confirmed' && distanceDays(today, start) === 1)
            await create(
              `reminder.pickup:${b.id}:${start}`,
              'pickup',
              `Jutro odbierasz pojazd — ${b.reference}`,
              'Twój wyjazd rozpoczyna się jutro.',
              base,
              'Sprawdź miejsce i godziny odbioru oraz wymagane dokumenty w szczegółach rezerwacji. Kaucja jest rozliczana oddzielnie.',
              { date: start },
            );
          if (b.status === 'in_rental' && distanceDays(today, end) === 1)
            await create(
              `reminder.return:${b.id}:${end}`,
              'return',
              `Jutro zwracasz pojazd — ${b.reference}`,
              'Termin zwrotu pojazdu przypada jutro.',
              base,
              'Sprawdź ustalenia z wypożyczalnią. Przy zwrocie porównaj stan pojazdu z protokołem.',
              { date: end },
            );
          if (
            b.status === 'completed' &&
            b.returned_at &&
            !b.reviewed &&
            distanceDays(localDay(new Date(b.returned_at)), today) === 2
          )
            await create(
              `reminder.review:${b.id}`,
              'review',
              `Jak oceniasz wyjazd? — ${b.reference}`,
              'Twój wynajem jest zakończony. Możesz podzielić się opinią o pojeździe i wypożyczalni.',
              base,
              'Dodaj opinię na koncie. Nie umieszczaj w niej danych prywatnych.',
              { date: today },
            );
        }
      }
      const unread = (
        await db.query(
          `WITH latest AS (
        SELECT DISTINCT ON(m.vehicle_id,m.traveler_id) m.* FROM messages m ORDER BY m.vehicle_id,m.traveler_id,m.created_at DESC,m.id DESC
      ), recipients AS (
        SELECT l.*,r.id recipient_id,r.role recipient_role FROM latest l JOIN vehicles v ON v.id=l.vehicle_id
        JOIN users r ON (l.author_id!=l.traveler_id AND r.id=l.traveler_id)
          OR (l.author_id=l.traveler_id AND r.role='owner' AND r.company_id=v.company_id AND r.id!=l.author_id)
      ) SELECT r.* FROM recipients r LEFT JOIN message_reads mr ON mr.vehicle_id=r.vehicle_id AND mr.traveler_id=r.traveler_id AND mr.user_id=r.recipient_id
      WHERE r.created_at>=$1 AND r.created_at<=$2::timestamptz-($3*interval '1 minute')
        AND (mr.read_through IS NULL OR mr.read_through<r.created_at)
        AND NOT EXISTS(SELECT 1 FROM notification_events e WHERE e.recipient_user_id=r.recipient_id
          AND e.resource_key='conversation:'||r.vehicle_id||':'||r.traveler_id::text
          AND (right(e.event_key,36)=r.id::text
            OR (e.created_at>$2::timestamptz-($5*interval '1 hour')
              AND NOT ($6::text='ses' AND ${completedLocalDelivery}))))
        ORDER BY r.created_at LIMIT $4`,
          [
            this.config.startAfter,
            now,
            this.config.unreadDelayMinutes,
            this.config.batchSize,
            this.config.unreadCooldownHours,
            this.config.mailProvider,
          ],
        )
      ).rows;
      for (const m of unread) {
        const conversation = createHash('sha256')
          .update(`${m.vehicle_id}:${m.traveler_id}:${m.recipient_id}`)
          .digest('hex');
        const prefix = `reminder.unread:${conversation}:`;
        const resourceKey = 'conversation:' + m.vehicle_id + ':' + m.traveler_id;
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [prefix]);
        const recent = await db.query(
          `SELECT 1 FROM notification_events e WHERE e.recipient_user_id=$1
          AND e.event_key LIKE $2 AND (right(e.event_key,36)=$6::text
            OR (e.created_at>$3::timestamptz-($4*interval '1 hour')
              AND NOT ($5::text='ses' AND ${completedLocalDelivery}))) LIMIT 1`,
          [
            m.recipient_id,
            prefix + '%',
            now,
            this.config.unreadCooldownHours,
            this.config.mailProvider,
            m.id,
          ],
        );
        if (recent.rowCount) continue;
        const path = m.recipient_role === 'owner' ? '/company/messages' : '/konto/wiadomosci';
        const id = await enqueueEvent(
          db,
          m.recipient_id,
          prefix + m.id,
          genericNotice(
            'Masz nieprzeczytaną wiadomość w VANLY',
            'W Twojej rozmowie czeka nowa wiadomość.',
            'Otwórz rozmowę w portalu, aby przeczytać treść i odpowiedzieć.',
            'Treść prywatnej rozmowy pozostaje dostępna po zalogowaniu.',
            url(this.config, path),
            {
              expiresAt: new Date(
                now.getTime() + this.config.unreadCooldownHours * 3600_000,
              ).toISOString(),
              category: 'WIADOMOŚCI VANLY',
              notificationGuard: {
                kind: 'unread',
                messageId: m.id,
                vehicleId: m.vehicle_id,
                travelerId: m.traveler_id,
              },
            },
          ),
          now,
          resourceKey,
        );
        if (id) queued.push(id);
      }
      return queued;
    });
    return { queued: jobs.length };
  }
}
export async function expireHoldsWithNotifications(
  pool,
  { config = loadNotificationConfig(), now = new Date() } = {},
) {
  return transaction(pool, async (db) => {
    const expired = (
      await db.query(
        `UPDATE bookings SET status='expired',updated_at=$1
      WHERE status='held' AND hold_until<=$1 RETURNING *`,
        [now],
      )
    ).rows;
    if (expired.length)
      await db.query('UPDATE allocations SET active=false WHERE booking_id=ANY($1::uuid[])', [
        expired.map((b) => b.id),
      ]);
    let queued = 0;
    if (config.enabled)
      for (const b of expired) {
        if (new Date(b.created_at) < new Date(config.startAfter)) continue;
        const subject = `Czas na dokończenie rezerwacji minął — ${b.reference}`;
        const id = await enqueueEvent(
          db,
          b.user_id,
          `booking.expired:${b.id}`,
          genericNotice(
            subject,
            'Tymczasowa blokada pojazdu wygasła i została zwolniona.',
            'Ta rezerwacja nie została potwierdzona. Sprawdź dostępność i utwórz nową prośbę, jeśli nadal planujesz wyjazd.',
            'Dotychczasowe dane i status rozliczeń znajdziesz na koncie.',
            url(config, '/konto/rezerwacja/' + b.id),
          ),
          now,
        );
        if (id) queued++;
      }
    return { expired: expired.length, queued };
  });
}
