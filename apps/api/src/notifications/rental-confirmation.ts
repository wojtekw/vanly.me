import type { BookingMailSnapshot } from './bookings';
import { NotificationDb, enqueueMail } from './queue';
import { date, money, notificationUrl } from './format';

export function notifyRentalConfirmation(
  db: NotificationDb,
  b: BookingMailSnapshot,
  documentRefs?: { documentId: string }[],
) {
  if (!b.payment_instructions?.trim()) throw new Error('RENTAL_PAYMENT_INSTRUCTIONS_REQUIRED');
  const pickup =
    [b.city, [b.street, b.house_number].filter(Boolean).join(' ')].filter(Boolean).join(', ') ||
    'Zgodnie z ustaleniami z wypożyczalnią';
  const variables = {
    booking_number: b.reference,
    traveler_name: b.traveler?.name || 'Podróżujący',
    vehicle_name: b.vehicle_name,
    rental_company_name: b.company_name,
    pickup_date: date(b.start_date),
    return_date: date(b.end_date),
    pickup_location: pickup,
    total_amount: money(b.total_minor),
    deposit_amount: money(b.deposit_minor),
    payment_instructions: b.payment_instructions,
    action_url: notificationUrl('/konto/rezerwacja/' + b.id),
  };
  const subject = `Potwierdzenie rezerwacji ${b.reference} — instrukcja płatności`;
  const body = `Wypożyczalnia ${b.company_name} potwierdziła rezerwację pojazdu ${b.vehicle_name}.\n\nRezerwacja dla: ${variables.traveler_name}\nNumer rezerwacji: ${b.reference}\nTermin: ${variables.pickup_date} – ${variables.return_date}\nOdbiór: ${pickup}\nCena najmu: ${variables.total_amount}\nKaucja, rozliczana osobno: ${variables.deposit_amount}\n\nInstrukcja płatności za wynajem:\n${b.payment_instructions}\n\nPłatność za wynajem i kaucję rozliczasz bezpośrednio z wypożyczalnią.\n${variables.action_url}`;
  return enqueueMail(db, b.user_id, subject, body, {
    eventKey: 'booking.confirmed:' + b.id,
    template: '13-potwierdzenie-i-platnosc',
    variables,
    documentRefs,
  });
}
