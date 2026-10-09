import { rentalPaymentInstructions } from './rental-payment';
import {
  Injectable,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { companyScope } from '../auth';
import type { User } from '../auth';
import { tx, audit } from '../db';
import { notifyBooking } from '../notifications/bookings';
import { createBookingDocuments } from '../documents/service';
import { BookingRepository } from './booking.repository';
import { BookingAccessPolicy } from './access-policy';

@Injectable()
export class BookingLifecycleService {
  constructor(
    private readonly repository: BookingRepository,
    private readonly access: BookingAccessPolicy,
  ) {}
  cancel(actor: User, id: string) {
    return tx(async (db) => {
      const booking = await this.access.require(db, actor, id, true);
      if (['cancelled', 'rejected', 'expired'].includes(booking.status)) return booking;
      if (['completed', 'in_rental'].includes(booking.status))
        throw new ConflictException('Trwający lub zakończony wynajem wymaga obsługi reklamacji.');
      await this.repository.cancel(db, id);
      await audit(db, actor, 'booking.cancelled', id);
      await notifyBooking(db, await this.access.require(db, actor, id), 'cancelled', {
        eventKey: 'booking.cancelled:' + id,
        testPayment: booking.has_test_payments,
      });
      return this.access.detail(db, actor, id);
    });
  }
  decide(actor: User, id: string, accept: boolean, instructions?: string) {
    return tx(async (db) => {
      if (actor.role !== 'owner')
        throw new ForbiddenException('Rezerwację potwierdza lub odrzuca wypożyczalnia.');
      const booking = await this.access.require(db, actor, id, true);
      companyScope(actor, booking.company_id);
      if (booking.status !== 'pending')
        throw new ConflictException('Rezerwacja nie czeka na decyzję.');
      if (accept && booking.snapshot.settlementMode === 'direct') {
        const {
          rows: [company],
        } = await db.query(
          "SELECT settings->>'paymentInstructions' instructions FROM companies WHERE id=$1 FOR SHARE",
          [booking.company_id],
        );
        const parsed = rentalPaymentInstructions.safeParse(
          instructions ?? company?.instructions ?? '',
        );
        if (!parsed.success)
          throw new BadRequestException(
            'Uzupełnij instrukcję płatności za wynajem przed potwierdzeniem rezerwacji. Zostanie wysłana podróżującemu w e-mailu.',
          );
        await this.repository.savePaymentInstructions(db, id, parsed.data);
      }
      await this.repository.decide(db, id, accept);
      await audit(db, actor, accept ? 'booking.accepted' : 'booking.rejected', id);
      const current = await this.access.require(db, actor, id);
      const eventKey = `booking.${accept ? 'confirmed' : 'rejected'}:${id}`;
      const documentRefs = accept
        ? await createBookingDocuments(db, id, { kind: 'summary', eventKey })
        : undefined;
      await notifyBooking(db, current, accept ? 'confirmed' : 'rejected', {
        eventKey,
        testPayment: booking.has_test_payments,
        documentRefs,
      });
      return this.access.detail(db, actor, id);
    });
  }
}
