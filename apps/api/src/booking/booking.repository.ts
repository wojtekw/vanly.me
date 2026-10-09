import { Injectable } from '@nestjs/common';
import { q } from '../db';
import { reservationStatusProjection } from './reservation-status';
import type {
  BookingDb,
  AccessibleBooking,
  BookingRow,
  BookingDetail,
  QuoteInput,
  QuoteSnapshot,
  QuoteRow,
  BookingExtraRow,
  PaymentRow,
  TravelServiceRow,
  AmendmentRow,
  HandoverRow,
  BookingStatus,
  DepositStatus,
} from './models';

const bookingProjection = `b.*,${reservationStatusProjection},v.name vehicle_name,v.asset,c.name company_name,
  COALESCE(b.snapshot->'vehicle'->>'city',v.city) city,
  COALESCE(b.snapshot->'vehicle'->>'street','') street,
  COALESCE(b.snapshot->'vehicle'->>'house_number','') house_number,
  EXISTS(SELECT 1 FROM payments p WHERE p.booking_id=b.id AND p.provider='local_test') AS has_test_payments`;

@Injectable()
export class BookingRepository {
  async find(db: BookingDb, id: string, lock = false) {
    const [row] = await q<AccessibleBooking>(
      `SELECT ${bookingProjection} FROM bookings b JOIN vehicles v ON v.id=b.vehicle_id
       JOIN companies c ON c.id=b.company_id WHERE b.id=$1 ${lock ? 'FOR UPDATE OF b' : ''}`,
      [id],
      db,
    );
    return row;
  }
  listForTraveler(db: BookingDb, userId: string) {
    return q<AccessibleBooking>(
      `SELECT ${bookingProjection} FROM bookings b JOIN vehicles v ON v.id=b.vehicle_id
       JOIN companies c ON c.id=b.company_id WHERE b.user_id=$1 ORDER BY b.created_at DESC`,
      [userId],
      db,
    );
  }
  async details(db: BookingDb, booking: AccessibleBooking): Promise<BookingDetail> {
    const id = booking.id;
    return {
      ...booking,
      extras: await this.extras(db, id),
      payments: await q<PaymentRow>(
        'SELECT * FROM payments WHERE booking_id=$1 ORDER BY created_at',
        [id],
        db,
      ),
      services: await q<TravelServiceRow>('SELECT * FROM services WHERE booking_id=$1', [id], db),
      amendments: await q<AmendmentRow>(
        'SELECT * FROM amendments WHERE booking_id=$1 ORDER BY created_at DESC',
        [id],
        db,
      ),
      handovers: await q<HandoverRow>(
        'SELECT * FROM handovers WHERE booking_id=$1 ORDER BY created_at',
        [id],
        db,
      ),
    };
  }
  extras(db: BookingDb, id: string) {
    return q<BookingExtraRow>('SELECT * FROM booking_extras WHERE booking_id=$1', [id], db);
  }
  async saveQuote(db: BookingDb, userId: string, input: QuoteInput, snapshot: QuoteSnapshot) {
    const [row] = await q<{ id: string; expires_at: Date | string }>(
      'INSERT INTO quotes(user_id,vehicle_id,input,snapshot) VALUES($1,$2,$3,$4) RETURNING id,expires_at',
      [userId, input.vehicleId, JSON.stringify(input), JSON.stringify(snapshot)],
      db,
    );
    return row;
  }
  async activeQuote(db: BookingDb, id: string, userId: string) {
    const [row] = await q<QuoteRow>(
      'SELECT * FROM quotes WHERE id=$1 AND user_id=$2 AND expires_at>now()',
      [id, userId],
      db,
    );
    return row;
  }
  async createHold(db: BookingDb, userId: string, quoteId: string, quote: QuoteSnapshot) {
    const [row] = await q<BookingRow>(
      `INSERT INTO bookings(user_id,company_id,vehicle_id,quote_id,start_date,end_date,guests,status,hold_until,total_minor,deposit_minor,buffer,snapshot)
       VALUES($1,$2,$3,$4,$5,$6,$7,'held',now()+interval '15 minutes',$8,$9,$10,$11) RETURNING *`,
      [
        userId,
        quote.vehicle.company_id,
        quote.vehicle.id,
        quoteId,
        quote.start,
        quote.end,
        quote.guests,
        quote.totalMinor,
        quote.depositMinor,
        quote.buffer,
        JSON.stringify(quote),
      ],
      db,
    );
    await db.query(
      `INSERT INTO allocations(vehicle_id,booking_id,company_id,occupied) VALUES($1,$2,$3,daterange($4::date,$5::date+$6::integer,'[)'))`,
      [row.vehicle_id, row.id, row.company_id, row.start_date, row.end_date, row.buffer],
    );
    await this.replaceExtras(db, row.id, row.company_id, quote);
    return { ...row, reservation_status: 'pending' as const };
  }
  async replaceExtras(db: BookingDb, booking: string, company: string, snapshot: QuoteSnapshot) {
    await db.query('DELETE FROM booking_extras WHERE booking_id=$1', [booking]);
    for (const extra of snapshot.extras)
      await db.query(
        'INSERT INTO booking_extras(booking_id,company_id,item_id,quantity,price,unit) VALUES($1,$2,$3,$4,$5,$6)',
        [booking, company, extra.id, extra.quantity, extra.price, extra.unit],
      );
  }
  async cancel(db: BookingDb, id: string) {
    await db.query(
      `UPDATE bookings SET status='cancelled',payment_status=CASE WHEN snapshot->>'settlementMode'='direct' THEN 'external' WHEN paid_minor>0 THEN 'refund_pending' ELSE 'unpaid' END,
       hold_until=NULL,updated_at=now() WHERE id=$1`,
      [id],
    );
    await this.releaseAllocation(db, id);
    await db.query(
      "UPDATE amendments SET status='rejected' WHERE booking_id=$1 AND status='pending'",
      [id],
    );
  }
  async decide(db: BookingDb, id: string, accept: boolean) {
    await db.query(
      `UPDATE bookings SET status=$1,payment_status=CASE WHEN $2 THEN payment_status
       WHEN snapshot->>'settlementMode'='direct' THEN 'external' WHEN paid_minor>0 THEN 'refund_pending' ELSE 'unpaid' END,updated_at=now() WHERE id=$3`,
      [accept ? 'confirmed' : 'rejected', accept, id],
    );
    if (!accept) {
      await this.releaseAllocation(db, id);
      await db.query(
        "UPDATE amendments SET status='rejected' WHERE booking_id=$1 AND status='pending'",
        [id],
      );
    }
  }
  releaseAllocation(db: BookingDb, id: string) {
    return db.query('UPDATE allocations SET active=false WHERE booking_id=$1', [id]);
  }
  async applyAmendment(db: BookingDb, booking: AccessibleBooking, snapshot: QuoteSnapshot) {
    await db.query(
      `UPDATE allocations SET occupied=daterange($1::date,$2::date+$3::integer,'[)') WHERE booking_id=$4`,
      [snapshot.start, snapshot.end, snapshot.buffer, booking.id],
    );
    await db.query(
      `UPDATE bookings SET start_date=$1,end_date=$2,total_minor=$3,snapshot=$4,buffer=$5,
       payment_status=CASE WHEN snapshot->>'settlementMode'='direct' THEN 'external' WHEN paid_minor>$3 THEN 'refund_pending' WHEN paid_minor=$3 THEN 'paid' ELSE 'partial' END,
       updated_at=now() WHERE id=$6`,
      [
        snapshot.start,
        snapshot.end,
        snapshot.totalMinor,
        JSON.stringify(snapshot),
        snapshot.buffer,
        booking.id,
      ],
    );
    await this.replaceExtras(db, booking.id, booking.company_id, snapshot);
  }
  setStatus(db: BookingDb, id: string, status: BookingStatus) {
    return db.query('UPDATE bookings SET status=$1,updated_at=now() WHERE id=$2', [status, id]);
  }
  setDepositStatus(db: BookingDb, id: string, status: DepositStatus) {
    return db.query('UPDATE bookings SET deposit_status=$1,updated_at=now() WHERE id=$2', [
      status,
      id,
    ]);
  }
}
