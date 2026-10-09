export const booking = () => ({
  id: '55555555-5555-4555-8555-555555555555', user_id: '11111111-1111-4111-8111-111111111111',
  company_id: 'baltyk-campers', vehicle_id: 'adria-twin-600', reference: 'VL-8A4C2D7E91',
  start_date: '2026-11-15', end_date: '2026-11-22', guests: 2, status: 'confirmed',
  payment_status: 'partial', deposit_status: 'scheduled', total_minor: 410000, paid_minor: 123000, deposit_minor: 400000,
  traveler: { name: 'Anna Kowalska', email: 'anna@example.com', note: 'Nie powielamy prywatnej wiadomości w PDF.' },
  has_test_payments: true,
  snapshot: {
    vehicle: { id: 'adria-twin-600', name: 'Adria Twin 600 SPB', company_id: 'baltyk-campers',
      company_name: 'Bałtyk Campers', city: 'Gdańsk', street: 'Żeglarska', house_number: '12',
      settings: { minDays: 2, buffer: 1, open: '09:00', close: '17:00', prep: 18000 } },
    start: '2026-11-15', end: '2026-11-22', baseMinor: 364000, prepMinor: 18000, equipmentMinor: 28000,
    totalMinor: 410000, depositMinor: 400000, balanceDue: '2026-11-08', plan: 'deposit',
    extras: [{ id: 'bike-rack', name: 'Bagażnik rowerowy', quantity: 1, price: 4000, unit: 'day', total: 28000 }],
  },
});
export const amendment = () => ({
  id: '66666666-6666-4666-8666-666666666666', booking_id: booking().id, status: 'accepted',
  previous: { start: '2026-11-15', end: '2026-11-22', totalMinor: 410000 },
  input: { note: 'Proszę o dodatkową dobę; odbiór dzień później.' }, created_at: '2026-10-07T12:00:00Z',
});
export const amendedBooking = () => {
  const b = booking();
  b.start_date = '2026-11-16'; b.end_date = '2026-11-24'; b.total_minor = 466000;
  Object.assign(b.snapshot, { start: b.start_date, end: b.end_date, baseMinor: 416000,
    equipmentMinor: 32000, totalMinor: b.total_minor, balanceDue: '2026-11-09',
    extras: [{ ...b.snapshot.extras[0], total: 32000 }] });
  return b;
};
export const handover = (kind = 'pickup', confirmed = false) => ({
  id: '77777777-7777-4777-8777-777777777777', booking_id: booking().id, kind,
  mileage: kind === 'pickup' ? 48720 : 50104, fuel: kind === 'pickup' ? 'Pełny' : '3/4',
  notes: kind === 'pickup' ? 'Drobna rysa na lewych drzwiach - zapisana przed wydaniem pojazdu.' : 'Pojazd zwrócono czysty. Stan wyposażenia sprawdzony.',
  checks: { equipment: true, condition: true, fuel: true }, confirmed,
  created_at: kind === 'pickup' ? '2026-11-15T09:00:00Z' : '2026-11-22T09:15:00Z',
});
