import { NotificationDb } from './queue';
import { BookingMailSnapshot } from './bookings';
import { date, money, notifyStatus } from './format';

type Booking = BookingMailSnapshot & { company_id: string };
type Amendment = {
  id: string;
  input: { start: string; end: string };
  snapshot: { totalMinor: number };
};
type Handover = { id: string; kind: 'pickup' | 'return' };
type Documents = { documentRefs?: { documentId: string }[] };
const dates = (b: BookingMailSnapshot) => `${date(b.start_date)} – ${date(b.end_date)}`;

async function owners(db: NotificationDb, companyId: string) {
  return (
    await db.query<{ id: string }>("SELECT id FROM users WHERE company_id=$1 AND role='owner'", [
      companyId,
    ])
  ).rows;
}
export async function notifyOwnerBookingRequest(db: NotificationDb, b: Booking) {
  for (const owner of await owners(db, b.company_id))
    await notifyStatus(db, {
      userId: owner.id,
      eventKey: `booking.request_received:${b.id}`,
      subject: `Nowa prośba wymaga decyzji — ${b.reference}`,
      category: 'PANEL WYPOŻYCZALNI',
      intro:
        'Podróżujący przesłał prośbę o rezerwację. Sprawdź dostępność i warunki przed podjęciem decyzji.',
      details: `Pojazd: ${b.vehicle_name}\nTermin: ${dates(b)}\nCena najmu: ${money(b.total_minor)}`,
      nextStep: 'Zaakceptuj lub odrzuć prośbę w panelu wypożyczalni.',
      cta: 'Rozpatrz prośbę',
      path: '/company/booking/' + b.id,
    });
}
export async function notifyAmendmentRequested(db: NotificationDb, b: Booking, a: Amendment) {
  await notifyStatus(db, {
    userId: b.user_id,
    eventKey: `amendment.requested:${a.id}`,
    subject: `Propozycja zmiany czeka na decyzję — ${b.reference}`,
    category: 'ZMIANA REZERWACJI',
    intro: 'Propozycja trafiła do wypożyczalni. Dotychczasowy termin i warunki nadal obowiązują.',
    details: `Proponowany termin: ${date(a.input.start)} – ${date(a.input.end)}\nProponowana cena: ${money(a.snapshot.totalMinor)}`,
    nextStep: 'Poczekaj na decyzję wypożyczalni.',
    cta: 'Sprawdź propozycję',
    path: '/konto/rezerwacja/' + b.id,
  });
  for (const owner of await owners(db, b.company_id))
    await notifyStatus(db, {
      userId: owner.id,
      eventKey: `amendment.received:${a.id}`,
      subject: `Propozycja zmiany wymaga decyzji — ${b.reference}`,
      category: 'PANEL WYPOŻYCZALNI',
      intro: 'Podróżujący proponuje zmianę terminu lub wyposażenia.',
      details: `Pojazd: ${b.vehicle_name}\nProponowany termin: ${date(a.input.start)} – ${date(a.input.end)}\nProponowana cena: ${money(a.snapshot.totalMinor)}`,
      nextStep: 'Przed decyzją sprawdź szczegóły propozycji w portalu.',
      cta: 'Sprawdź zmianę',
      path: '/company/booking/' + b.id,
    });
}
export function notifyAmendmentDecision(
  db: NotificationDb,
  b: Booking,
  a: Amendment,
  accept: boolean,
  options: Documents = {},
) {
  const balance = Math.max(0, b.total_minor - b.paid_minor);
  return notifyStatus(db, {
    userId: b.user_id,
    eventKey: `amendment.${accept ? 'accepted' : 'rejected'}:${a.id}`,
    subject: `Zmiana ${accept ? 'zaakceptowana' : 'odrzucona'} — ${b.reference}`,
    category: 'ZMIANA REZERWACJI',
    intro: accept
      ? 'Wypożyczalnia zaakceptowała zmianę. Nowe warunki są zapisane.'
      : 'Wypożyczalnia odrzuciła propozycję. Dotychczasowe warunki pozostają aktualne.',
    details:
      b.snapshot.settlementMode === 'direct'
        ? `Aktualny termin: ${dates(b)}\nCena najmu: ${money(b.total_minor)}\nKaucja, rozliczana osobno: ${money(b.deposit_minor)}\nNajem i kaucję rozliczasz bezpośrednio z wypożyczalnią. VANLY nie pobiera wpłat.`
        : `Aktualny termin: ${dates(b)}\nCena najmu: ${money(b.total_minor)}\nZapisane wpłaty: ${money(b.paid_minor)}\nPozostało: ${money(balance)}\nKaucja, rozliczana osobno: ${money(b.deposit_minor)}`,
    nextStep:
      b.payment_status === 'refund_pending'
        ? 'Rozliczenie nadpłaty oczekuje na zwrot. To nie jest potwierdzenie przelewu.'
        : b.snapshot.settlementMode === 'direct'
          ? 'Sprawdź szczegóły rezerwacji. Zmianę rozliczenia uzgodnij z wypożyczalnią.'
          : 'Sprawdź szczegóły rezerwacji i oddzielny status płatności w portalu.',
    cta: 'Otwórz rezerwację',
    path: '/konto/rezerwacja/' + b.id,
    ...options,
  });
}
export function notifyHandoverCreated(
  db: NotificationDb,
  b: Booking,
  h: Handover,
  options: Documents = {},
) {
  const kind = h.kind === 'pickup' ? 'odbioru' : 'zwrotu';
  return notifyStatus(db, {
    userId: b.user_id,
    eventKey: `handover.created:${h.id}`,
    subject: `Sprawdź protokół ${kind} — ${b.reference}`,
    category: 'ODBIÓR I ZWROT',
    intro: `Wypożyczalnia zapisała protokół ${kind} pojazdu.`,
    details: `Pojazd: ${b.vehicle_name}\nWypożyczalnia: ${b.company_name}\nTermin najmu: ${dates(b)}`,
    nextStep:
      'Porównaj zapis ze stanem pojazdu. Potwierdź protokół po wyjaśnieniu ewentualnych różnic.',
    cta: 'Sprawdź protokół',
    path: '/konto/rezerwacja/' + b.id,
    ...options,
  });
}
export async function notifyHandoverConfirmed(
  db: NotificationDb,
  b: Booking,
  h: Handover,
  options: Documents = {},
) {
  const kind = h.kind === 'pickup' ? 'odbioru' : 'zwrotu';
  await notifyStatus(db, {
    userId: b.user_id,
    eventKey: `handover.confirmed:${h.id}`,
    subject: `Protokół ${kind} został potwierdzony — ${b.reference}`,
    category: 'ODBIÓR I ZWROT',
    intro: `Twoje potwierdzenie protokołu ${kind} jest zapisane w VANLY.`,
    details: `Pojazd: ${b.vehicle_name}\nWypożyczalnia: ${b.company_name}`,
    nextStep: 'Protokół znajdziesz na koncie. Status kaucji jest rozliczany oddzielnie.',
    cta: 'Otwórz protokół',
    path: '/konto/rezerwacja/' + b.id,
    ...options,
  });
  for (const owner of await owners(db, b.company_id))
    await notifyStatus(db, {
      userId: owner.id,
      eventKey: `handover.confirmed_by_traveler:${h.id}`,
      subject: `Podróżujący potwierdził protokół ${kind} — ${b.reference}`,
      category: 'PANEL WYPOŻYCZALNI',
      intro: `Potwierdzenie protokołu ${kind} jest zapisane.`,
      details: `Pojazd: ${b.vehicle_name}`,
      nextStep: 'Sprawdź dokument i dalszą obsługę rezerwacji w panelu.',
      cta: 'Sprawdź protokół',
      path: '/company/booking/' + b.id,
      ...options,
    });
}
export function notifyDepositChanged(
  db: NotificationDb,
  b: Booking,
  change: { status: 'authorized' | 'released' | 'claim_pending'; reason: string; eventId: string },
) {
  const labels = {
    authorized: 'Zapisano zabezpieczenie kaucji',
    released: 'Zapisano zwolnienie kaucji',
    claim_pending: 'Kaucja wymaga wyjaśnienia',
  };
  return notifyStatus(db, {
    userId: b.user_id,
    eventKey: `deposit.changed:${b.id}:${change.eventId}`,
    subject: `${labels[change.status]} — ${b.reference}`,
    category: 'KAUCJA ZA POJAZD',
    intro: 'Wypożyczalnia zmieniła zapisany status kaucji w portalu.',
    details: `Pojazd: ${b.vehicle_name}\nKaucja, oddzielnie od ceny najmu: ${money(b.deposit_minor)}`,
    nextStep:
      'Jest to zapis statusu przez wypożyczalnię, a nie potwierdzenie operacji bankowej. Szczegóły i uzasadnienie znajdziesz po zalogowaniu.',
    cta: 'Sprawdź kaucję',
    path: '/konto/rezerwacja/' + b.id,
  });
}
export async function notifyBookingExpired(
  db: NotificationDb,
  b: { id: string; reference: string; user_id: string; created_at: string | Date },
) {
  if (process.env.MAIL_REMINDERS_ENABLED !== 'true') return;
  const cutoff = Date.parse(process.env.NOTIFICATION_START_AFTER || '');
  if (!Number.isFinite(cutoff)) throw new Error('NOTIFICATION_START_AFTER_REQUIRED');
  if (new Date(b.created_at).getTime() < cutoff) return;
  const eventKey = `booking.expired:${b.id}`;
  const recorded = await db.query(
    `INSERT INTO notification_events(recipient_user_id,event_key)
    VALUES($1,$2) ON CONFLICT(recipient_user_id,event_key) DO NOTHING RETURNING event_key`,
    [b.user_id, eventKey],
  );
  if (!recorded.rowCount) return;
  const jobId = await notifyStatus(db, {
    userId: b.user_id,
    eventKey,
    subject: `Czas na dokończenie rezerwacji minął — ${b.reference}`,
    category: 'TWOJA REZERWACJA',
    intro: 'Tymczasowa blokada pojazdu wygasła i została zwolniona.',
    details:
      'Ta rezerwacja nie została potwierdzona. Sprawdź dostępność i utwórz nową prośbę, jeśli nadal planujesz wyjazd.',
    nextStep: 'Dotychczasowe dane i status rozliczeń znajdziesz na koncie.',
    cta: 'Otwórz rezerwację',
    path: '/konto/rezerwacja/' + b.id,
  });
  await db.query(
    'UPDATE notification_events SET job_id=$3 WHERE recipient_user_id=$1 AND event_key=$2',
    [b.user_id, eventKey, jobId],
  );
}
