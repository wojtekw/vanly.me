import {
  Injectable,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import type { User } from '../auth';
import { tx, audit } from '../db';
import { notifyBooking } from '../notifications/bookings';
import { notifyOwnerBookingRequest } from '../notifications/booking-events';
import { BookingAccessPolicy } from './access-policy';
import { PaymentRepository } from './payment.repository';
import { IdempotencyService } from './idempotency.service';
import type { TravelerInput } from './models';
import { legacyTravelerPayments } from './payment-mode';

@Injectable()
export class BookingPaymentService {
  constructor(
    private readonly repository: PaymentRepository,
    private readonly access: BookingAccessPolicy,
    private readonly idempotency: IdempotencyService,
  ) {}
  private requireLocalPayments() {
    if (process.env.LOCAL_PAYMENTS !== 'true')
      throw new ForbiddenException('Płatności testowe są wyłączone.');
  }
  pay(actor: User, id: string, traveler: TravelerInput, key: unknown) {
    if (!legacyTravelerPayments())
      throw new ForbiddenException(
        'VANLY nie pobiera wpłat od podróżujących. Zatwierdź rezerwację bez płatności.',
      );
    this.requireLocalPayments();
    return tx((db) =>
      this.idempotency.run(db, actor, 'payment', key, { id, traveler }, async () => {
        const booking = await this.access.require(db, actor, id, true);
        if (booking.snapshot.settlementMode === 'direct')
          throw new ForbiddenException('Najem rozliczasz z wypożyczalnią.');
        if (booking.user_id !== actor.id)
          throw new ForbiddenException('Ta płatność należy do podróżnika.');
        if (
          booking.status !== 'held' ||
          !booking.hold_until ||
          new Date(booking.hold_until).getTime() <= Date.now()
        )
          throw new ConflictException('Blokada wygasła lub rezerwacja została już opłacona.');
        if (traveler.scenario === 'failure')
          throw new BadRequestException('Testowa płatność została odrzucona. Nie zapisano wpłaty.');
        const amount = booking.snapshot.dueNowMinor;
        const status = 'pending';
        await this.repository.record(
          db,
          id,
          'payment',
          amount,
          `payment:${actor.id}:${String(key)}`,
        );
        await this.repository.firstPayment(db, booking, traveler, amount, status);
        await audit(db, actor, 'payment.local_test', id, { amount });
        const current = await this.access.require(db, actor, id);
        const eventKey = `booking.request_submitted:${id}`;
        await notifyBooking(db, current, status, {
          eventKey,
          testPayment: true,
          amountMinor: amount,
        });
        await notifyOwnerBookingRequest(db, current);
        return this.access.detail(db, actor, id);
      }),
    );
  }
  balance(actor: User, id: string, key: unknown) {
    this.requireLocalPayments();
    return tx((db) =>
      this.idempotency.run(db, actor, 'balance', key, { id }, async () => {
        const booking = await this.access.require(db, actor, id, true);
        if (booking.snapshot.settlementMode === 'direct')
          throw new ForbiddenException('Najem rozliczasz bezpośrednio z wypożyczalnią.');
        if (booking.user_id !== actor.id) throw new ForbiddenException();
        if (!['pending', 'confirmed', 'in_rental'].includes(booking.status))
          throw new ConflictException('Dopłata jest niedostępna.');
        const amount = booking.total_minor - booking.paid_minor;
        if (amount <= 0) throw new ConflictException('Cena jest już opłacona.');
        await this.repository.record(
          db,
          id,
          'payment',
          amount,
          `balance:${actor.id}:${String(key)}`,
        );
        await this.repository.balance(db, id);
        await audit(db, actor, 'payment.balance_test', id, { amount });
        await notifyBooking(db, await this.access.require(db, actor, id), 'balance', {
          eventKey: `payment.balance:${id}:${String(key)}`,
          testPayment: true,
          amountMinor: amount,
        });
        return this.access.detail(db, actor, id);
      }),
    );
  }
  refund(actor: User, id: string, key: unknown) {
    if (actor.role !== 'admin')
      throw new ForbiddenException('Zwrot testowy wymaga uprawnień operatora.');
    this.requireLocalPayments();
    return tx((db) =>
      this.idempotency.run(db, actor, 'refund', key, { id }, async () => {
        const booking = await this.access.require(db, actor, id, true);
        const cancelled = ['cancelled', 'rejected'].includes(booking.status);
        const amount = booking.paid_minor - (cancelled ? 0 : booking.total_minor);
        if (booking.payment_status !== 'refund_pending' || amount <= 0)
          throw new ConflictException('Brak kwoty do zwrotu.');
        await this.repository.record(db, id, 'refund', amount, `refund:${actor.id}:${String(key)}`);
        await this.repository.refund(db, id, amount, cancelled);
        await audit(db, actor, 'payment.refund_test', id, { amount });
        await notifyBooking(db, await this.access.require(db, actor, id), 'refund', {
          eventKey: `payment.refund:${id}:${String(key)}`,
          testPayment: true,
          amountMinor: amount,
        });
        return this.access.detail(db, actor, id);
      }),
    );
  }
}
