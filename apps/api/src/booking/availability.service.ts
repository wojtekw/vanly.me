import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { InventoryRepository } from './inventory.repository';
import type {
  BookingDb,
  BookingExtraRow,
  QuoteInput,
  QuoteSnapshot,
  QuotedExtra,
  VehicleForQuote,
} from './models';

@Injectable()
export class AvailabilityService {
  constructor(private readonly inventory: InventoryRepository) {}
  async assertDates(
    db: BookingDb,
    vehicle: VehicleForQuote,
    input: QuoteInput,
    buffer: number,
    excludeBooking?: string,
  ) {
    if (
      (
        await this.inventory.conflicts(
          db,
          vehicle.id,
          input.start,
          input.end,
          buffer,
          excludeBooking,
        )
      ).length
    )
      throw new ConflictException('Ten termin jest już zajęty. Wybierz inne daty.');
  }
  async equipment(
    db: BookingDb,
    vehicle: VehicleForQuote,
    input: QuoteInput,
    dayCount: number,
    previous?: { snapshot: QuoteSnapshot; extras: BookingExtraRow[] },
    excludeBooking?: string,
    lock = false,
  ): Promise<QuotedExtra[]> {
    // Lock all stock rows in a stable order before reading assignments and usage.
    const stock = await this.inventory.list(db, vehicle.company_id, lock);
    const assignments = await this.inventory.assignments(db, vehicle.company_id, vehicle.id);
    const used = await this.inventory.usage(
      db,
      vehicle.company_id,
      input.start,
      input.end,
      excludeBooking,
    );
    const extras: QuotedExtra[] = [];
    for (const [id, quantity] of Object.entries(input.extras)) {
      if (!quantity) continue;
      const item = stock.find((row) => row.id === id);
      const old = previous?.extras.find((row) => row.item_id === id);
      const assigned = assignments.some((row) => row.item_id === id);
      const retained = item && (!item.active || !assigned) && old && quantity <= old.quantity;
      if (item && !item.active && !retained)
        throw new BadRequestException('Wybrane wyposażenie zostało zarchiwizowane.');
      if (!item || (!assigned && !retained))
        throw new BadRequestException('Wybrane wyposażenie nie pasuje do pojazdu.');
      const available = item.quantity - (used.find((row) => row.item_id === id)?.used || 0);
      if (quantity > available)
        throw new ConflictException(`Dostępność: ${item.name}, pozostało ${available} szt.`);
      const price = retained ? old.price : item.price;
      const unit = retained ? old.unit : item.unit;
      extras.push({
        id,
        name: retained
          ? previous?.snapshot.extras.find((row) => row.id === id)?.name || item.name
          : item.name,
        quantity,
        price,
        unit,
        total: quantity * price * (unit === 'day' ? dayCount : 1),
      });
    }
    return extras;
  }
}
