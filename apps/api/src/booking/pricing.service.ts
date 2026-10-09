import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PricingRepository } from './pricing.repository';
import { InventoryRepository } from './inventory.repository';
import { AvailabilityService } from './availability.service';
import { day, days, today } from './dates';
import { quoteSchema } from './http-schemas';
import type { BookingDb, QuoteInput, QuoteSnapshot } from './models';
import { legacyTravelerPayments } from './payment-mode';

@Injectable()
export class PricingService {
  constructor(
    private readonly repository: PricingRepository,
    private readonly availability: AvailabilityService,
  ) {}
  async calculate(
    db: BookingDb,
    input: QuoteInput,
    excludeBooking?: string,
    lock = false,
  ): Promise<QuoteSnapshot> {
    const data = quoteSchema.parse(input);
    const count = days(data.start, data.end);
    if (data.start < today() || count < 1 || count > 60)
      throw new BadRequestException('Wybierz przyszły termin od 1 do 60 dób.');
    const vehicle = await this.repository.vehicle(db, data.vehicleId, lock);
    if (
      !vehicle ||
      (!excludeBooking &&
        (vehicle.status !== 'published' || !vehicle.verified || !vehicle.publication_active))
    )
      throw new NotFoundException('Oferta jest niedostępna.');
    const minimum = Math.max(vehicle.min_days, Number(vehicle.settings.minDays || 2));
    if (count < minimum) throw new BadRequestException(`Minimalny najem to ${minimum} doby.`);
    if (data.guests > vehicle.sleeps || (vehicle.type !== 'trailer' && data.guests > vehicle.seats))
      throw new BadRequestException('Pojazd ma za mało miejsc dla tej grupy.');
    const buffer = Number(vehicle.settings.buffer ?? 1);
    await this.availability.assertDates(db, vehicle, data, buffer, excludeBooking);
    const previous = excludeBooking
      ? await this.repository.previous(db, excludeBooking, vehicle)
      : undefined;
    if (excludeBooking && !previous)
      throw new BadRequestException('Nieprawidłowa rezerwacja do zmiany.');
    const extras = await this.availability.equipment(
      db,
      vehicle,
      data,
      count,
      previous,
      excludeBooking,
      lock,
    );
    const seasons = await this.repository.seasons(db, vehicle, data.start, data.end);
    const rates = Array.from({ length: count }, (_, index) => {
      const date = day(data.start, index);
      const season = seasons.find((row) => row.start_date <= date && row.end_date > date);
      return { date, rate: season?.rate ?? vehicle.daily };
    });
    const baseMinor = rates.reduce((sum, row) => sum + row.rate, 0);
    const prepMinor = Number(vehicle.settings.prep ?? vehicle.prep);
    const equipmentMinor = extras.reduce((sum, row) => sum + row.total, 0);
    const totalMinor = baseMinor + prepMinor + equipmentMinor;
    // Booking/payment columns use PostgreSQL integer amounts in grosz.
    if (!Number.isSafeInteger(totalMinor) || totalMinor > 2147483647 || totalMinor < 0)
      throw new BadRequestException(
        'Kwota wyceny przekracza obsługiwany limit. Zmień wybrane wyposażenie lub termin.',
      );
    const direct = previous
      ? previous.snapshot.settlementMode === 'direct'
      : !legacyTravelerPayments();
    const plan = direct
      ? 'direct'
      : days(today(), data.start) < 7
        ? 'full'
        : data.plan === 'direct'
          ? 'deposit'
          : data.plan;
    // An amendment changes dates/equipment, never the agreed pickup location.
    const pickup = previous?.snapshot.vehicle;
    if (pickup)
      Object.assign(vehicle, {
        city: pickup.city ?? vehicle.city,
        street: pickup.street ?? '',
        house_number: pickup.house_number ?? '',
        lat: pickup.lat ?? null,
        lng: pickup.lng ?? null,
        deposit: previous.snapshot.depositMinor,
      });
    return {
      company: previous?.snapshot.company || {
        id: vehicle.company_id,
        name: pickup?.company_name || vehicle.company_name,
      },
      companySettings: previous?.snapshot.companySettings || pickup?.settings || vehicle.settings,
      vehicle,
      days: count,
      rates,
      baseMinor,
      prepMinor,
      equipmentMinor,
      extras,
      totalMinor,
      depositMinor: vehicle.deposit,
      buffer,
      plan,
      dueNowMinor: direct ? 0 : plan === 'deposit' ? Math.round(totalMinor * 0.3) : totalMinor,
      balanceDue: direct ? null : day(data.start, -7),
      settlementMode: direct ? 'direct' : 'local_test',
      platformFeeMinor: 0,
      currency: 'PLN',
      start: data.start,
      end: data.end,
      guests: data.guests,
    };
  }
}

const pricing = new PricingService(
  new PricingRepository(),
  new AvailabilityService(new InventoryRepository()),
);
// Temporary compatibility export; HTTP handlers use the injected feature service.
export const calcQuote = (
  db: BookingDb,
  input: QuoteInput,
  excludeBooking?: string,
  lock = false,
) => pricing.calculate(db, input, excludeBooking, lock);
