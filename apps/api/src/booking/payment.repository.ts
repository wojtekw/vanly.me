import { Injectable } from '@nestjs/common';
import type { BookingDb, AccessibleBooking, TravelerInput } from './models';

@Injectable()
export class PaymentRepository {
  record(
    db: BookingDb,
    bookingId: string,
    kind: 'payment' | 'refund',
    amount: number,
    key: string,
  ) {
    return db.query(
      `INSERT INTO payments(booking_id,kind,amount_minor,idempotency_key) VALUES($1,$2,$3,$4)`,
      [bookingId, kind, amount, key],
    );
  }
  async firstPayment(
    db: BookingDb,
    booking: AccessibleBooking,
    traveler: TravelerInput,
    amount: number,
    status: 'confirmed' | 'pending',
  ) {
    await db.query(
      'UPDATE bookings SET status=$1,hold_until=NULL,paid_minor=$2,payment_status=$3,traveler=$4,updated_at=now() WHERE id=$5',
      [
        status,
        amount,
        amount === booking.total_minor ? 'paid' : 'partial',
        JSON.stringify(traveler),
        booking.id,
      ],
    );
    await db.query('INSERT INTO tasks(company_id,booking_id,title) VALUES($1,$2,$3)', [
      booking.company_id,
      booking.id,
      `Przygotuj ${booking.vehicle_name}`,
    ]);
  }
  balance(db: BookingDb, id: string) {
    return db.query(
      `UPDATE bookings SET paid_minor=total_minor,payment_status='paid',updated_at=now() WHERE id=$1`,
      [id],
    );
  }
  refund(db: BookingDb, id: string, amount: number, cancelled: boolean) {
    return db.query(
      'UPDATE bookings SET paid_minor=paid_minor-$1,payment_status=$2,updated_at=now() WHERE id=$3',
      [amount, cancelled ? 'refunded' : 'paid', id],
    );
  }
}
