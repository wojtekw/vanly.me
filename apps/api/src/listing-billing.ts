import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { User } from './auth';
import { companyScope } from './auth';
import { q, tx, audit } from './db';
import { IdempotencyService } from './booking/idempotency.service';

export const LISTING_FEE_MINOR = 20000;
export const listingIdempotency = new IdempotencyService();
export async function listingBilling(companyId: string) {
  const [count] = await q('SELECT count(*)::int n FROM vehicles WHERE company_id=$1', [companyId]);
  return {
    nextFeeMinor: count.n === 0 ? 0 : LISTING_FEE_MINOR,
    currency: 'PLN',
    frequency: 'one_time',
    testPaymentsEnabled: process.env.LOCAL_PAYMENTS === 'true',
    fees: await q('SELECT * FROM vehicle_listing_fees WHERE company_id=$1 ORDER BY created_at', [
      companyId,
    ]),
  };
}
export function payListingFee(actor: User, id: string, body: unknown, key: unknown) {
  if (process.env.LOCAL_PAYMENTS !== 'true')
    throw new ForbiddenException('Płatności testowe są wyłączone.');
  const input = z
    .object({ scenario: z.enum(['success', 'failure']).default('success') })
    .strict()
    .parse(body);
  return tx((db) =>
    listingIdempotency.run(db, actor, 'listing.pay_test', key, { id, ...input }, async () => {
      // Same lock order as vehicle edits; one successful settlement per vehicle.
      const [vehicle] = await q('SELECT * FROM vehicles WHERE id=$1 FOR UPDATE', [id], db);
      if (!vehicle) throw new NotFoundException();
      companyScope(actor, vehicle.company_id);
      const [fee] = await q(
        'SELECT * FROM vehicle_listing_fees WHERE vehicle_id=$1 AND company_id=$2 FOR UPDATE',
        [id, actor.company_id],
        db,
      );
      if (!fee) throw new NotFoundException('Brak opłaty za ten pojazd.');
      if (fee.status !== 'pending') return fee;
      if (input.scenario === 'failure')
        throw new BadRequestException(
          'Testowa płatność została odrzucona. Opłata pozostaje nierozliczona.',
        );
      const [paid] = await q(
        "UPDATE vehicle_listing_fees SET status='paid_test',provider='local_test',paid_at=now() WHERE vehicle_id=$1 RETURNING *",
        [id],
        db,
      );
      await audit(db, actor, 'listing.payment_test', id, {
        amountMinor: fee.amount_minor,
        currency: fee.currency,
      });
      return paid;
    }),
  );
}
