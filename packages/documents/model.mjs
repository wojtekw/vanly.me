import { DocumentError } from './errors.mjs';

export const documentKinds = ['summary', 'amendment', 'pickup', 'return'];
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const moneyFields = ['total_minor', 'paid_minor', 'deposit_minor'];
const bookingStatuses = [
  'held',
  'pending',
  'confirmed',
  'in_rental',
  'completed',
  'cancelled',
  'rejected',
  'expired',
];

function text(value, max = 1000) {
  if (typeof value !== 'string') return '';
  if (value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw new DocumentError('DOCUMENT_INVALID_TEXT');
  return value.trim();
}
function integer(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new DocumentError('DOCUMENT_INVALID_INTEGER');
  return value;
}
function date(value) {
  const result = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (
    typeof result !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    Number.isNaN(Date.parse(result)) ||
    new Date(result + 'T12:00:00Z').toISOString().slice(0, 10) !== result
  )
    throw new DocumentError('DOCUMENT_INVALID_DATE');
  return result;
}
function timestamp(value) {
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new DocumentError('DOCUMENT_INVALID_TIMESTAMP');
  return result.toISOString();
}

// Never persist the whole vehicle/profile row: only facts necessary for this document.
// In particular current company settings cannot replace the quote's saved settings.
export function bookingDocumentSnapshot(booking, options = {}) {
  const kind = options.kind || 'summary';
  if (!documentKinds.includes(kind) || !uuid.test(booking.id) || !uuid.test(booking.user_id))
    throw new DocumentError('DOCUMENT_INVALID_BOOKING');
  const quote = booking.snapshot;
  if (!quote || typeof quote !== 'object' || !quote.vehicle)
    throw new DocumentError('DOCUMENT_QUOTE_UNAVAILABLE');
  const vehicle = quote.vehicle;
  const savedSettings = quote.companySettings || vehicle.settings || {};
  const totalMinor = integer(booking.total_minor);
  for (const key of moneyFields) integer(booking[key]);
  if (!bookingStatuses.includes(booking.status)) throw new DocumentError('DOCUMENT_INVALID_STATUS');
  if (
    !['unpaid', 'partial', 'paid', 'refund_pending', 'refunded', 'external'].includes(
      booking.payment_status,
    ) ||
    !['scheduled', 'authorized', 'released', 'claim_pending'].includes(booking.deposit_status)
  )
    throw new DocumentError('DOCUMENT_INVALID_SETTLEMENT');
  const start = date(booking.start_date),
    end = date(booking.end_date);
  if (
    end <= start ||
    (quote.start && date(quote.start) !== start) ||
    (quote.end && date(quote.end) !== end) ||
    quote.totalMinor !== totalMinor ||
    quote.depositMinor !== booking.deposit_minor
  )
    throw new DocumentError('DOCUMENT_QUOTE_MISMATCH');
  const baseMinor = integer(quote.baseMinor),
    prepMinor = integer(quote.prepMinor),
    equipmentMinor = integer(quote.equipmentMinor);
  const extras = (quote.extras || []).map((extra) => ({
    name: text(extra.name, 160),
    quantity: integer(extra.quantity),
    priceMinor: integer(extra.price),
    unit: extra.unit,
    totalMinor: integer(extra.total),
  }));
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
  if (
    extras.some(
      (e) =>
        !['day', 'trip'].includes(e.unit) ||
        e.quantity < 1 ||
        e.totalMinor !== e.quantity * e.priceMinor * (e.unit === 'day' ? days : 1),
    ) ||
    extras.reduce((sum, e) => sum + e.totalMinor, 0) !== equipmentMinor ||
    baseMinor + prepMinor + equipmentMinor !== totalMinor
  )
    throw new DocumentError('DOCUMENT_PRICE_BREAKDOWN_MISMATCH');
  const model = {
    schemaVersion: 1,
    kind,
    bookingId: booking.id,
    userId: booking.user_id,
    companyId: booking.company_id,
    reference: text(booking.reference, 40),
    vehicleName: text(vehicle.name, 160) || text(booking.vehicle_id, 80),
    companyName:
      text(quote.company?.name || vehicle.company_name, 160) ||
      'Nazwa firmy nie została zapisana w wycenie',
    start,
    end,
    days,
    guests: integer(booking.guests),
    bookingStatus: booking.status,
    paymentStatus: booking.payment_status,
    depositStatus: booking.deposit_status,
    totalMinor,
    paidMinor: booking.paid_minor,
    balanceMinor: Math.max(0, totalMinor - booking.paid_minor),
    overpaymentMinor: Math.max(0, booking.paid_minor - totalMinor),
    depositMinor: booking.deposit_minor,
    baseMinor,
    prepMinor,
    equipmentMinor,
    extras,
    plan:
      quote.settlementMode === 'direct' ? 'direct' : quote.plan === 'deposit' ? 'deposit' : 'full',
    settlementMode: quote.settlementMode === 'direct' ? 'direct' : 'local_test',
    balanceDue: quote.balanceDue ? date(quote.balanceDue) : null,
    pickupLocation: [
      text(vehicle.city, 120),
      [text(vehicle.street, 160), text(vehicle.house_number, 30)].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(', '),
    travelerName: text(booking.traveler?.name, 100),
    companySettings: {
      ...(Number.isSafeInteger(savedSettings.minDays)
        ? { minDays: integer(savedSettings.minDays) }
        : {}),
      ...(Number.isSafeInteger(savedSettings.buffer)
        ? { buffer: integer(savedSettings.buffer) }
        : {}),
      open: text(savedSettings.open, 30),
      close: text(savedSettings.close, 30),
      cancellationSetting: text(savedSettings.cancel, 1000),
    },
    testPayments: booking.has_test_payments === true,
    recordedAt: timestamp(options.recordedAt || new Date()),
  };
  if (kind === 'amendment') {
    const amendment = options.amendment;
    if (
      !amendment ||
      amendment.booking_id !== booking.id ||
      amendment.status !== 'accepted' ||
      !amendment.previous
    )
      throw new DocumentError('DOCUMENT_AMENDMENT_NOT_ACCEPTED');
    model.amendment = {
      id: amendment.id,
      createdAt: timestamp(amendment.created_at),
      previousStart: date(amendment.previous.start),
      previousEnd: date(amendment.previous.end),
      previousTotalMinor: integer(amendment.previous.totalMinor),
      note: text(amendment.input?.note, 1000),
    };
  }
  if (['pickup', 'return'].includes(kind)) {
    const handover = options.handover;
    if (!handover || handover.booking_id !== booking.id || handover.kind !== kind)
      throw new DocumentError('DOCUMENT_HANDOVER_UNAVAILABLE');
    model.handover = {
      id: handover.id,
      kind,
      mileage: integer(handover.mileage),
      fuel: text(handover.fuel, 40),
      notes: text(handover.notes, 3000),
      confirmed: handover.confirmed === true,
      createdAt: timestamp(handover.created_at),
      checks: {
        equipment: handover.checks?.equipment === true,
        condition: handover.checks?.condition === true,
        fuel: handover.checks?.fuel === true,
      },
    };
  }
  return model;
}
