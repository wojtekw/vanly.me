import { Injectable } from '@nestjs/common';
import { q } from '../db';
import type {
  BookingDb,
  AmendmentRow,
  QuoteInput,
  QuoteSnapshot,
  AccessibleBooking,
} from './models';

@Injectable()
export class AmendmentRepository {
  async find(db: BookingDb, id: string, lock = false) {
    const [row] = await q<AmendmentRow>(
      `SELECT * FROM amendments WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
      db,
    );
    return row;
  }
  async create(
    db: BookingDb,
    bookingId: string,
    userId: string,
    input: QuoteInput & { note: string },
    snapshot: QuoteSnapshot,
  ) {
    const [row] = await q<AmendmentRow>(
      'INSERT INTO amendments(booking_id,requested_by,input,snapshot) VALUES($1,$2,$3,$4) RETURNING *',
      [bookingId, userId, JSON.stringify(input), JSON.stringify(snapshot)],
      db,
    );
    return row;
  }
  decide(db: BookingDb, id: string, accept: boolean, previous: AccessibleBooking) {
    return db.query('UPDATE amendments SET status=$1,previous=$2 WHERE id=$3', [
      accept ? 'accepted' : 'rejected',
      JSON.stringify({
        start: previous.start_date,
        end: previous.end_date,
        totalMinor: previous.total_minor,
        snapshot: previous.snapshot,
      }),
      id,
    ]);
  }
}
