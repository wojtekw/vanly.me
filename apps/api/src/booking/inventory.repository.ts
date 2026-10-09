import { Injectable } from '@nestjs/common';
import { q } from '../db';
import { today } from './dates';
import type { BookingDb, StockRow, StockUsage, StockMinimum } from './models';

@Injectable()
export class InventoryRepository {
  usage(db: BookingDb, company: string, start: string, end: string, excludeBooking?: string) {
    return q<StockUsage>(
      `WITH relevant AS (
        SELECT e.item_id,e.quantity,greatest(b.start_date,$2::date) starts,least(b.end_date,$3::date) ends
        FROM booking_extras e JOIN bookings b ON b.id=e.booking_id AND b.company_id=e.company_id
        WHERE e.company_id=$1 AND b.status IN('held','pending','confirmed','in_rental')
          AND (b.status!='held' OR b.hold_until>now()) AND b.start_date<$3::date AND b.end_date>$2::date
          AND ($4::uuid IS NULL OR b.id<>$4::uuid)
      ),events AS (SELECT item_id,starts dt,quantity delta FROM relevant UNION ALL SELECT item_id,ends,-quantity FROM relevant),
      daily AS(SELECT item_id,dt,sum(delta) delta FROM events GROUP BY item_id,dt),
      running AS(SELECT item_id,sum(delta) OVER(PARTITION BY item_id ORDER BY dt) used FROM daily)
      SELECT item_id,max(used)::int used FROM running GROUP BY item_id`,
      [company, start, end, excludeBooking || null],
      db,
    );
  }
  // A reduced stock level must cover every current and future reservation.
  minimum(db: BookingDb, company: string, itemId?: string) {
    return q<StockMinimum>(
      `WITH relevant AS (
        SELECT e.item_id,e.quantity,greatest(b.start_date,$2::date) starts,b.end_date ends
        FROM booking_extras e JOIN bookings b ON b.id=e.booking_id AND b.company_id=e.company_id
        WHERE e.company_id=$1 AND ($3::text IS NULL OR e.item_id=$3)
          AND b.status IN('held','pending','confirmed','in_rental')
          AND (b.status!='held' OR b.hold_until>now()) AND b.end_date>$2::date
      ),events AS (SELECT item_id,starts dt,quantity delta FROM relevant UNION ALL SELECT item_id,ends,-quantity FROM relevant),
      daily AS (SELECT item_id,dt,sum(delta) delta FROM events GROUP BY item_id,dt),
      running AS (SELECT item_id,sum(delta) OVER(PARTITION BY item_id ORDER BY dt) needed FROM daily)
      SELECT item_id,max(needed)::int needed FROM running GROUP BY item_id`,
      [company, today(), itemId || null],
      db,
    );
  }
  list(db: BookingDb, company: string, lock: boolean) {
    return q<StockRow>(
      `SELECT * FROM stock_items WHERE company_id=$1 ORDER BY id ${lock ? 'FOR UPDATE' : ''}`,
      [company],
      db,
    );
  }
  assignments(db: BookingDb, company: string, vehicle: string) {
    return q<{ item_id: string }>(
      'SELECT item_id FROM stock_item_vehicles WHERE company_id=$1 AND vehicle_id=$2',
      [company, vehicle],
      db,
    );
  }
  conflicts(
    db: BookingDb,
    vehicle: string,
    start: string,
    end: string,
    buffer: number,
    excludeBooking?: string,
  ) {
    return q<{ id: string }>(
      `SELECT id FROM allocations WHERE vehicle_id=$1 AND active
       AND occupied && daterange($2::date,$3::date+$4::integer,'[)')
       AND ($5::uuid IS NULL OR booking_id IS DISTINCT FROM $5::uuid)`,
      [vehicle, start, end, buffer, excludeBooking || null],
      db,
    );
  }
}

const inventory = new InventoryRepository();
// Temporary compatibility exports for catalogue operations.
export const stockUsage = (
  db: BookingDb,
  company: string,
  start: string,
  end: string,
  excludeBooking?: string,
) => inventory.usage(db, company, start, end, excludeBooking);
export const stockMinimum = (db: BookingDb, company: string, itemId?: string) =>
  inventory.minimum(db, company, itemId);
