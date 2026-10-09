import { z } from 'zod';
import { rentalPaymentInstructions } from './booking/rental-payment';
import { Controller, Get, Post, Param, Body, Req } from '@nestjs/common';
import { user } from './auth';
import type { Authed } from './auth';
import { BookingService } from './booking/booking.service';
import { BookingPaymentService } from './booking/payment.service';
import { BookingLifecycleService } from './booking/lifecycle.service';
import { BookingAmendmentService } from './booking/amendment.service';
import { BookingHandoverService } from './booking/handover.service';
import {
  quoteSchema,
  holdSchema,
  decisionSchema,
  travelerSchema,
  reservationSchema,
  amendmentSchema,
  handoverSchema,
  depositSchema,
} from './booking/http-schemas';

// Compatibility facade for older catalogue/media/community imports.
export { dateSchema, day, days, today } from './booking/dates';
export { quoteSchema } from './booking/http-schemas';
export { stockUsage, stockMinimum } from './booking/inventory.repository';
export { calcQuote } from './booking/pricing.service';
export { accessibleBooking } from './booking/access-policy';

@Controller('api/v1')
export class BookingController {
  constructor(
    private readonly bookings: BookingService,
    private readonly payments: BookingPaymentService,
    private readonly lifecycle: BookingLifecycleService,
    private readonly amendments: BookingAmendmentService,
    private readonly handovers: BookingHandoverService,
  ) {}
  @Post('quotes') quote(@Req() req: Authed, @Body() body: unknown) {
    return this.bookings.quote(user(req), quoteSchema.parse(body));
  }
  @Post('holds') hold(@Req() req: Authed, @Body() body: unknown) {
    return this.bookings.hold(
      user(req),
      holdSchema.parse(body).quoteId,
      req.headers['idempotency-key'],
    );
  }
  @Get('bookings') list(@Req() req: Authed) {
    return this.bookings.list(user(req));
  }
  @Get('bookings/:id') detail(@Req() req: Authed, @Param('id') id: string) {
    return this.bookings.detail(user(req), id);
  }
  @Post('bookings/:id/pay-test') pay(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.payments.pay(
      user(req),
      id,
      travelerSchema.parse(body),
      req.headers['idempotency-key'],
    );
  }
  @Post('bookings/:id/submit') submit(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.bookings.submit(
      user(req),
      id,
      reservationSchema.parse(body),
      req.headers['idempotency-key'],
    );
  }
  @Post('bookings/:id/balance-test') balance(@Req() req: Authed, @Param('id') id: string) {
    return this.payments.balance(user(req), id, req.headers['idempotency-key']);
  }
  @Post('bookings/:id/cancel') cancel(@Req() req: Authed, @Param('id') id: string) {
    return this.lifecycle.cancel(user(req), id);
  }
  @Post('bookings/:id/decision') decision(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const actor = user(req, ['owner']);
    const input = z
      .object({ accept: z.boolean(), paymentInstructions: rentalPaymentInstructions.optional() })
      .strict()
      .parse(body);
    return this.lifecycle.decide(actor, id, input.accept, input.paymentInstructions);
  }
  @Post('bookings/:id/refund-test') refund(@Req() req: Authed, @Param('id') id: string) {
    return this.payments.refund(user(req, ['admin']), id, req.headers['idempotency-key']);
  }
  @Post('bookings/:id/amendments') amendment(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.amendments.request(user(req), id, amendmentSchema.parse(body));
  }
  @Post('amendments/:id/decision') amendmentDecision(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.amendments.decide(
      user(req, ['owner', 'admin']),
      id,
      decisionSchema.parse(body).accept,
    );
  }
  @Post('bookings/:id/handovers') handover(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.handovers.create(user(req, ['owner', 'admin']), id, handoverSchema.parse(body));
  }
  @Post('handovers/:id/confirm') confirmHandover(@Req() req: Authed, @Param('id') id: string) {
    return this.handovers.confirm(user(req), id);
  }
  @Post('bookings/:id/deposit') deposit(
    @Req() req: Authed,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.handovers.deposit(user(req, ['owner', 'admin']), id, depositSchema.parse(body));
  }
}
