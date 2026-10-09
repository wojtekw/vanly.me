import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { User } from '../auth';
import type { BookingDb } from './models';
import { BookingRepository } from './booking.repository';

@Injectable()
export class BookingAccessPolicy {
  constructor(private readonly repository: BookingRepository) {}
  async require(db: BookingDb, actor: User, id: string, lock = false) {
    const booking = await this.repository.find(db, z.uuid().parse(id), lock);
    if (!booking) throw new NotFoundException('Nie znaleziono rezerwacji.');
    if (
      actor.role !== 'admin' &&
      booking.user_id !== actor.id &&
      !(actor.role === 'owner' && actor.company_id === booking.company_id)
    )
      throw new ForbiddenException('Nie masz dostępu do tej rezerwacji.');
    return booking;
  }
  async detail(db: BookingDb, actor: User, id: string) {
    return this.repository.details(db, await this.require(db, actor, id));
  }
}

const access = new BookingAccessPolicy(new BookingRepository());
// Temporary compatibility export for media/community, kept outside HTTP logic.
export const accessibleBooking = (db: BookingDb, actor: User, id: string, lock = false) =>
  access.require(db, actor, id, lock);
