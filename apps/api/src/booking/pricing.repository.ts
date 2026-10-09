import { Injectable } from '@nestjs/common';
import { q } from '../db';
import type {
  BookingDb,
  VehicleForQuote,
  SeasonRow,
  QuoteSnapshot,
  BookingExtraRow,
} from './models';

@Injectable()
export class PricingRepository {
  async vehicle(db: BookingDb, id: string, lock: boolean) {
    const [vehicle] = await q<VehicleForQuote>(
      `SELECT v.*,false AS instant,c.name company_name,c.settings,c.verified FROM vehicles v JOIN companies c ON c.id=v.company_id
       WHERE v.id=$1 ${lock ? 'FOR NO KEY UPDATE OF v FOR SHARE OF c' : ''}`,
      [id],
      db,
    );
    return vehicle;
  }
  seasons(db: BookingDb, vehicle: VehicleForQuote, start: string, end: string) {
    return q<SeasonRow>(
      `SELECT * FROM seasons WHERE company_id=$1 AND (vehicle_id IS NULL OR vehicle_id=$2)
       AND start_date<$3 AND end_date>$4 ORDER BY (vehicle_id IS NOT NULL) DESC,start_date DESC`,
      [vehicle.company_id, vehicle.id, end, start],
      db,
    );
  }
  async previous(db: BookingDb, booking: string, vehicle: VehicleForQuote) {
    const [row] = await q<{ snapshot: QuoteSnapshot }>(
      'SELECT snapshot FROM bookings WHERE id=$1 AND company_id=$2 AND vehicle_id=$3',
      [booking, vehicle.company_id, vehicle.id],
      db,
    );
    if (!row) return undefined;
    const extras = await q<BookingExtraRow>(
      'SELECT item_id,quantity,price,unit FROM booking_extras WHERE booking_id=$1 AND company_id=$2',
      [booking, vehicle.company_id],
      db,
    );
    return { snapshot: row.snapshot, extras };
  }
}
