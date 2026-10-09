import {
  Injectable,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { companyScope } from '../auth';
import type { User } from '../auth';
import { tx, expireHolds, audit } from '../db';
import { notifyAmendmentRequested, notifyAmendmentDecision } from '../notifications/booking-events';
import { createBookingDocuments } from '../documents/service';
import { BookingRepository } from './booking.repository';
import { AmendmentRepository } from './amendment.repository';
import { BookingAccessPolicy } from './access-policy';
import { PricingService } from './pricing.service';
import type { AmendmentInput } from './models';

@Injectable()
export class BookingAmendmentService {
  constructor(
    private readonly repository: AmendmentRepository,
    private readonly bookings: BookingRepository,
    private readonly access: BookingAccessPolicy,
    private readonly pricing: PricingService,
  ) {}
  request(actor: User, id: string, proposal: AmendmentInput) {
    return tx(async (db) => {
      await expireHolds(db);
      const booking = await this.access.require(db, actor, id, true);
      if (booking.user_id !== actor.id || !['pending', 'confirmed'].includes(booking.status))
        throw new ForbiddenException('Zmianę może zaproponować podróżnik przed odbiorem.');
      const extras = await this.bookings.extras(db, id);
      const input = {
        vehicleId: booking.vehicle_id,
        start: proposal.start,
        end: proposal.end,
        guests: booking.guests,
        extras:
          proposal.extras ||
          Object.fromEntries(extras.map((extra) => [extra.item_id, extra.quantity])),
        plan: booking.snapshot.plan,
      };
      const snapshot = await this.pricing.calculate(db, input, id, true);
      const amendment = await this.repository.create(
        db,
        id,
        actor.id,
        { ...input, note: proposal.note },
        snapshot,
      );
      await audit(db, actor, 'booking.amendment_requested', id, { amendment: amendment.id });
      await notifyAmendmentRequested(db, booking, amendment);
      return amendment;
    });
  }
  decide(actor: User, id: string, accept: boolean) {
    return tx(async (db) => {
      const parsedId = z.uuid().parse(id);
      const candidate = await this.repository.find(db, parsedId);
      if (!candidate) throw new NotFoundException();
      // Every operation locks booking before amendment, matching cancellation.
      const booking = await this.access.require(db, actor, candidate.booking_id, true);
      companyScope(actor, booking.company_id);
      const amendment = await this.repository.find(db, parsedId, true);
      if (
        !amendment ||
        amendment.status !== 'pending' ||
        !['confirmed', 'pending'].includes(booking.status)
      )
        throw new ConflictException('Zmiana nie jest już dostępna.');
      if (accept) {
        const { note: _note, ...input } = amendment.input;
        const fresh = await this.pricing.calculate(db, input, booking.id, true);
        if (fresh.totalMinor !== amendment.snapshot.totalMinor)
          throw new ConflictException(
            'Wycena zmieniła się. Podróżnik musi ponownie sprawdzić cenę.',
          );
        await this.bookings.applyAmendment(db, booking, fresh);
      }
      await this.repository.decide(db, id, accept, booking);
      await audit(
        db,
        actor,
        accept ? 'booking.amendment_accepted' : 'booking.amendment_rejected',
        booking.id,
      );
      const current = await this.access.require(db, actor, booking.id);
      const eventKey = `amendment.${accept ? 'accepted' : 'rejected'}:${id}`;
      const documentRefs = accept
        ? await createBookingDocuments(db, booking.id, {
            kind: 'amendment',
            sourceId: id,
            eventKey,
          })
        : undefined;
      await notifyAmendmentDecision(db, current, amendment, accept, { documentRefs });
      return this.access.detail(db, actor, booking.id);
    });
  }
}
