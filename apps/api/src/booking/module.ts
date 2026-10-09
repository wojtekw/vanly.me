import { Module } from '@nestjs/common';
import { BookingController } from '../bookings';
import { BookingRepository } from './booking.repository';
import { InventoryRepository } from './inventory.repository';
import { PricingRepository } from './pricing.repository';
import { PaymentRepository } from './payment.repository';
import { AmendmentRepository } from './amendment.repository';
import { HandoverRepository } from './handover.repository';
import { BookingAccessPolicy } from './access-policy';
import { IdempotencyService } from './idempotency.service';
import { AvailabilityService } from './availability.service';
import { PricingService } from './pricing.service';
import { BookingService } from './booking.service';
import { BookingPaymentService } from './payment.service';
import { BookingLifecycleService } from './lifecycle.service';
import { BookingAmendmentService } from './amendment.service';
import { BookingHandoverService } from './handover.service';

@Module({
  controllers: [BookingController],
  providers: [
    BookingRepository,
    InventoryRepository,
    PricingRepository,
    PaymentRepository,
    AmendmentRepository,
    HandoverRepository,
    BookingAccessPolicy,
    IdempotencyService,
    AvailabilityService,
    PricingService,
    BookingService,
    BookingPaymentService,
    BookingLifecycleService,
    BookingAmendmentService,
    BookingHandoverService,
  ],
  exports: [BookingAccessPolicy, PricingService, AvailabilityService],
})
export class BookingModule {}
