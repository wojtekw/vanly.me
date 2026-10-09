import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  HttpException,
} from '@nestjs/common';
import { z } from 'zod';
import type { User } from './auth';
import { q, tx, audit } from './db';
import { IdempotencyService } from './booking/idempotency.service';
import type { PoolClient } from 'pg';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const CREDIT_PRICE_MINOR = 20000;
export const listingIdempotency = new IdempotencyService();
const credits = new Function('specifier', 'return import(specifier)')(
  pathToFileURL(path.resolve(__dirname, '../../../packages/credits/service.mjs')).href,
);
async function invoke(method: string, ...args: any[]) {
  const service = await credits;
  try {
    return await service[method](...args);
  } catch (error) {
    if (error instanceof service.CreditsError)
      throw new HttpException((error as Error).message, (error as any).status);
    throw error;
  }
}
export const lockCreditWallet = (db: PoolClient, companyId: string) =>
  invoke('lockWallet', db, companyId);
export const registerPublication = (db: PoolClient, wallet: any, id: string, exempt: boolean) =>
  invoke('registerPublication', db, wallet, id, exempt);
export const publishVehicle = (db: PoolClient, wallet: any, id: string, userId: string) =>
  invoke('publishVehicle', db, wallet, id, { userId });
export const stopPublication = (db: PoolClient, companyId: string, id: string) =>
  invoke('stopPublication', db, companyId, id);
export async function listingBilling(companyId: string) {
  const [count] = await q('SELECT count(*)::int n FROM vehicles WHERE company_id=$1', [companyId]);
  const [wallet] = await q('SELECT balance,updated_at FROM credit_wallets WHERE company_id=$1', [
    companyId,
  ]);
  return {
    model: 'credits',
    creditPriceMinor: CREDIT_PRICE_MINOR,
    currency: 'PLN',
    firstVehicleFree: true,
    nextPublicationCredits: count.n === 0 ? 0 : 1,
    testPaymentsEnabled: process.env.LOCAL_PAYMENTS === 'true',
    wallet: wallet || { balance: 0 },
    publications: await q(
      'SELECT p.*,v.name vehicle_name FROM vehicle_publications p JOIN vehicles v ON v.id=p.vehicle_id WHERE p.company_id=$1 ORDER BY v.name',
      [companyId],
    ),
    ledger: await q(
      'SELECT l.*,v.name vehicle_name FROM credit_ledger l LEFT JOIN vehicles v ON v.id=l.vehicle_id WHERE l.company_id=$1 ORDER BY l.sequence DESC LIMIT 100',
      [companyId],
    ),
  };
}
export function buyCredits(actor: User, body: unknown, key: unknown) {
  if (process.env.LOCAL_PAYMENTS !== 'true')
    throw new ForbiddenException('Płatności testowe są wyłączone.');
  const input = z
    .object({
      credits: z.number().int().min(1).max(100000),
      scenario: z.enum(['success', 'failure']).default('success'),
    })
    .strict()
    .parse(body);
  return tx((db) =>
    listingIdempotency.run(db, actor, 'credits.buy_test', key, input, async () => {
      if (input.scenario === 'failure')
        throw new BadRequestException(
          'Testowa płatność została odrzucona. Portfel nie został zasilony.',
        );
      const wallet = await lockCreditWallet(db, actor.company_id!);
      const receipt = await invoke('purchaseCredits', db, wallet, input.credits, {
        userId: actor.id,
        eventKey: `credits.purchase:${actor.id}:${key}`,
      });
      await audit(db, actor, 'credits.purchase_test', receipt.id, {
        credits: input.credits,
        amountMinor: receipt.amount_minor,
        currency: 'PLN',
      });
      return receipt;
    }),
  );
}
export function payListingFee() {
  throw new GoneException(
    'Rozliczenia pojedynczych opłat zastąpił portfel Creditsów. Zasil portfel wypożyczalni.',
  );
}
