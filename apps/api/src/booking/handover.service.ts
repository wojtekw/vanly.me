import { Injectable, ConflictException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { companyScope } from '../auth';
import type { User } from '../auth';
import { tx, audit } from '../db';
import {
  notifyHandoverCreated,
  notifyHandoverConfirmed,
  notifyDepositChanged,
} from '../notifications/booking-events';
import { createBookingDocuments } from '../documents/service';
import { BookingRepository } from './booking.repository';
import { HandoverRepository } from './handover.repository';
import { BookingAccessPolicy } from './access-policy';
import type { HandoverInput, DepositStatus } from './models';

@Injectable()
export class BookingHandoverService {
  constructor(
    private readonly repository: HandoverRepository,
    private readonly bookings: BookingRepository,
    private readonly access: BookingAccessPolicy,
  ) {}
  create(actor: User, id: string, input: HandoverInput) {
    return tx(async (db) => {
      const booking = await this.access.require(db, actor, id, true);
      companyScope(actor, booking.company_id);
      if (input.kind === 'pickup' && booking.status !== 'confirmed')
        throw new ConflictException('Najpierw potwierdź rezerwację.');
      if (input.kind === 'return' && booking.status !== 'in_rental')
        throw new ConflictException('Najpierw zapisz odbiór pojazdu.');
      const handover = await this.repository.create(db, id, actor.id, input);
      await this.bookings.setStatus(db, id, input.kind === 'pickup' ? 'in_rental' : 'completed');
      await audit(db, actor, 'handover.' + input.kind, id);
      const eventKey = `handover.created:${handover.id}`;
      const documentRefs = await createBookingDocuments(db, id, {
        kind: input.kind,
        sourceId: handover.id,
        eventKey,
      });
      await notifyHandoverCreated(db, booking, handover, { documentRefs });
      return handover;
    });
  }
  confirm(actor: User, id: string) {
    return tx(async (db) => {
      const parsedId = z.uuid().parse(id);
      const candidate = await this.repository.find(db, parsedId);
      if (!candidate) throw new ForbiddenException();
      const booking = await this.access.require(db, actor, candidate.booking_id, true);
      if (booking.user_id !== actor.id) throw new ForbiddenException();
      const handover = await this.repository.find(db, parsedId, true);
      if (!handover) throw new ForbiddenException();
      if (handover.confirmed) return { ok: true };
      const confirmed = await this.repository.confirm(db, id);
      await audit(db, actor, 'handover.confirmed', booking.id);
      const eventKey = `handover.confirmed:${id}`;
      const documentRefs = await createBookingDocuments(db, booking.id, {
        kind: handover.kind,
        sourceId: id,
        eventKey,
      });
      await notifyHandoverConfirmed(db, booking, confirmed, { documentRefs });
      return { ok: true };
    });
  }
  deposit(
    actor: User,
    id: string,
    change: { status: Exclude<DepositStatus, 'scheduled'>; reason: string },
  ) {
    return tx(async (db) => {
      const booking = await this.access.require(db, actor, id, true);
      companyScope(actor, booking.company_id);
      if (!['confirmed', 'in_rental', 'completed'].includes(booking.status))
        throw new ConflictException('Kaucja nie jest dostępna dla tego statusu.');
      if (change.status !== 'authorized' && booking.status !== 'completed')
        throw new ConflictException('Rozliczenie kaucji wymaga protokołu zwrotu.');
      if (booking.deposit_status === change.status) return { ok: true };
      await this.bookings.setDepositStatus(db, id, change.status);
      const eventId = randomUUID();
      await audit(db, actor, 'deposit.local_status', id, { ...change, eventId });
      await notifyDepositChanged(db, booking, { ...change, eventId });
      return { ok: true };
    });
  }
}
