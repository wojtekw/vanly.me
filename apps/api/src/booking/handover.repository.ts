import { Injectable } from '@nestjs/common';
import { q } from '../db';
import type { BookingDb, HandoverRow, HandoverInput } from './models';

@Injectable()
export class HandoverRepository {
  async find(db: BookingDb, id: string, lock = false) {
    const [row] = await q<HandoverRow>(
      `SELECT * FROM handovers WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
      db,
    );
    return row;
  }
  async create(db: BookingDb, booking: string, userId: string, input: HandoverInput) {
    const [row] = await q<HandoverRow>(
      'INSERT INTO handovers(booking_id,created_by,kind,mileage,fuel,notes,checks) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [
        booking,
        userId,
        input.kind,
        input.mileage,
        input.fuel,
        input.notes,
        JSON.stringify(input.checks),
      ],
      db,
    );
    return row;
  }
  async confirm(db: BookingDb, id: string) {
    const [row] = await q<HandoverRow>(
      'UPDATE handovers SET confirmed=true WHERE id=$1 RETURNING *',
      [id],
      db,
    );
    return row;
  }
}
