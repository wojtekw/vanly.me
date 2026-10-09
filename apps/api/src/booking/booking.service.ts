import { Injectable, ConflictException, ForbiddenException } from '@nestjs/common';
import type { User } from '../auth';
import { tx, pool, expireHolds, audit } from '../db';
import { BookingRepository } from './booking.repository';
import { BookingAccessPolicy } from './access-policy';
import { PricingService } from './pricing.service';
import { IdempotencyService } from './idempotency.service';
import type { QuoteInput } from './models';
import type { TravelerInput } from './models';
import { notifyBooking } from '../notifications/bookings';
import { notifyOwnerBookingRequest } from '../notifications/booking-events';

@Injectable()
export class BookingService {
  constructor(
    private readonly repository: BookingRepository,
    private readonly access: BookingAccessPolicy,
    private readonly pricing: PricingService,
    private readonly idempotency: IdempotencyService,
  ) {}
  quote(actor: User, input: QuoteInput) {
    return tx(async (db) => {
      await expireHolds(db);
      const snapshot = await this.pricing.calculate(db, input);
      return { ...(await this.repository.saveQuote(db, actor.id, input, snapshot)), ...snapshot };
    });
  }
  hold(actor: User, quoteId: string, key: unknown) {
    return tx((db) =>
      this.idempotency.run(db, actor, 'hold', key, { quoteId }, async () => {
        const quote = await this.repository.activeQuote(db, quoteId, actor.id);
        if (!quote) throw new ConflictException('Wycena wygasła. Sprawdź cenę ponownie.');
        await expireHolds(db);
        const fresh = await this.pricing.calculate(db, quote.input, undefined, true);
        if (
          fresh.totalMinor !== quote.snapshot.totalMinor ||
          fresh.depositMinor !== quote.snapshot.depositMinor ||
          fresh.dueNowMinor !== quote.snapshot.dueNowMinor ||
          fresh.plan !== quote.snapshot.plan
        )
          throw new ConflictException('Warunki oferty zmieniły się. Sprawdź nową wycenę.');
        const booking = await this.repository.createHold(db, actor.id, quoteId, fresh);
        await audit(db, actor, 'booking.held', booking.id);
        return booking;
      }),
    );
  }
  async list(actor: User) {
    await expireHolds();
    return this.repository.listForTraveler(pool, actor.id);
  }
  submit(actor: User, id: string, traveler: Omit<TravelerInput, 'scenario'>, key: unknown) {
    return tx((db) =>
      this.idempotency.run(db, actor, 'booking.submit', key, { id, traveler }, async () => {
        const b = await this.access.require(db, actor, id, true);
        if (b.user_id !== actor.id) throw new ForbiddenException('To nie jest Twoja rezerwacja.');
        if (b.status !== 'held' || !b.hold_until || new Date(b.hold_until).getTime() <= Date.now())
          throw new ConflictException('Blokada wygasła lub rezerwacja została już zatwierdzona.');
        const status = 'pending';
        const snapshot = {
          ...b.snapshot,
          vehicle: { ...b.snapshot.vehicle, instant: false },
          settlementMode: 'direct',
          plan: 'direct',
          dueNowMinor: 0,
          balanceDue: null,
          platformFeeMinor: 0,
        };
        await db.query(
          `UPDATE bookings SET status=$1,hold_until=NULL,payment_status='external',traveler=$2,snapshot=$3,updated_at=now() WHERE id=$4`,
          [status, JSON.stringify(traveler), JSON.stringify(snapshot), id],
        );
        await db.query('INSERT INTO tasks(company_id,booking_id,title) VALUES($1,$2,$3)', [
          b.company_id,
          id,
          `Przygotuj ${b.vehicle_name}`,
        ]);
        await audit(db, actor, 'booking.submitted', id, { settlementMode: 'direct' });
        const current = await this.access.require(db, actor, id);
        const eventKey = `booking.request_submitted:${id}`;
        await notifyBooking(db, current, status, { eventKey });
        await notifyOwnerBookingRequest(db, current);
        return this.access.detail(db, actor, id);
      }),
    );
  }
  async detail(actor: User, id: string) {
    await expireHolds();
    return this.access.detail(pool, actor, id);
  }
}
