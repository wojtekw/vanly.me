import { notifyRentalConfirmation } from './rental-confirmation';
import { NotificationDb } from './queue';
import { date, money, notifyStatus } from './format';

export type BookingMailSnapshot = {
  id: string;
  reference: string;
  user_id: string;
  vehicle_name: string;
  company_name: string;
  start_date: string;
  end_date: string;
  total_minor: number;
  paid_minor: number;
  deposit_minor: number;
  payment_status: string;
  payment_instructions?: string;
  traveler?: { name?: string };
  city?: string;
  street?: string;
  house_number?: string;
  snapshot: { balanceDue?: string | null; settlementMode?: string };
};
type BookingNoticeKind = 'pending' | 'confirmed' | 'cancelled' | 'rejected' | 'balance' | 'refund';

const captions: Record<BookingNoticeKind, string> = {
  pending: 'Rezerwacja jest niepotwierdzona',
  confirmed: 'Rezerwacja jest potwierdzona',
  cancelled: 'Rezerwacja została anulowana',
  rejected: 'Rezerwacja została odrzucona',
  balance: 'Zapisano dopłatę testową',
  refund: 'Zapisano zwrot testowy',
};

export function notifyBooking(
  db: NotificationDb,
  b: BookingMailSnapshot,
  kind: BookingNoticeKind,
  operation: {
    eventKey: string;
    testPayment?: boolean;
    amountMinor?: number;
    documentRefs?: { documentId: string }[];
  },
) {
  if (kind === 'confirmed' && b.snapshot.settlementMode === 'direct')
    return notifyRentalConfirmation(db, b, operation.documentRefs);
  const balance = Math.max(0, b.total_minor - b.paid_minor);
  const intro: Record<BookingNoticeKind, string> = {
    pending:
      'Rezerwacja ma status „Niepotwierdzona”. Wypożyczalnia potwierdzi ją lub odrzuci. Wyjazd nie jest jeszcze potwierdzony.',
    confirmed: 'Sprawdź termin, miejsce odbioru i oddzielne rozliczenia wyjazdu.',
    cancelled: 'Rezerwacja została anulowana. Sprawdź oddzielny status rozliczenia.',
    rejected: 'Wypożyczalnia nie zaakceptowała prośby. Sprawdź oddzielny status rozliczenia.',
    balance: 'Dopłata została zapisana w scenariuszu testowym.',
    refund: 'Zwrot został zapisany w scenariuszu testowym; nie wykonano przelewu.',
  };
  const details = [
    `Pojazd: ${b.vehicle_name}`,
    `Wypożyczalnia: ${b.company_name}`,
    `Termin: ${date(b.start_date)} – ${date(b.end_date)}`,
    `Cena najmu: ${money(b.total_minor)}`,
    ...(b.snapshot.settlementMode === 'direct'
      ? ['Najem i kaucję rozliczasz bezpośrednio z wypożyczalnią według jej warunków.']
      : [`Zapisane wpłaty: ${money(b.paid_minor)}`]),
    ...(b.snapshot.settlementMode !== 'direct' && ['pending', 'confirmed', 'balance'].includes(kind)
      ? [
          `Pozostało: ${money(balance)}`,
          ...(balance > 0 && b.snapshot.balanceDue
            ? [`Termin dopłaty: ${date(b.snapshot.balanceDue)}`]
            : []),
        ]
      : []),
    ...(operation.amountMinor ? [`Kwota operacji testowej: ${money(operation.amountMinor)}`] : []),
    `Kaucja, rozliczana osobno: ${money(b.deposit_minor)}`,
    ...(b.payment_status === 'refund_pending'
      ? ['Rozliczenie oczekuje na zwrot. To nie jest potwierdzenie wykonania zwrotu.']
      : []),
    ...(operation.testPayment
      ? [
          'W tej lokalnej wersji wpłaty, dopłaty i zwroty są testowe. Nie pobrano ani nie wypłacono rzeczywistych pieniędzy.',
        ]
      : []),
  ].join('\n');
  return notifyStatus(db, {
    userId: b.user_id,
    eventKey: operation.eventKey,
    subject: `${captions[kind]} — ${b.reference}`,
    category: 'TWOJA REZERWACJA',
    intro: intro[kind],
    details,
    nextStep:
      kind === 'pending' && b.snapshot.settlementMode === 'direct'
        ? 'Po potwierdzeniu rezerwacji przez wypożyczalnię otrzymasz e-mail z podsumowaniem i instrukcją płatności za wynajem.'
        : 'Aktualny stan rezerwacji, wpłat i kaucji znajdziesz na koncie.',
    cta: 'Sprawdź rezerwację',
    path: '/konto/rezerwacja/' + b.id,
    documentRefs: operation.documentRefs,
  });
}
