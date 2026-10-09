import { z } from 'zod';
import { dateSchema } from './dates';

const extras = z.record(z.string(), z.number().int().min(0).max(20));
export const quoteSchema = z
  .object({
    vehicleId: z.string().min(1).max(80),
    start: dateSchema,
    end: dateSchema,
    guests: z.number().int().min(1).max(12),
    extras: extras.default({}),
    plan: z.enum(['deposit', 'full', 'direct']).default('direct'),
  })
  .strict();
export const holdSchema = z.object({ quoteId: z.uuid() });
export const decisionSchema = z.object({ accept: z.boolean() });
export const travelerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.email().max(160),
  note: z.string().max(1000).default(''),
  accept: z.literal(true),
  scenario: z.enum(['success', 'failure']).default('success'),
});
export const reservationSchema = travelerSchema.omit({ scenario: true }).strict();
export const amendmentSchema = z.object({
  start: dateSchema,
  end: dateSchema,
  extras: extras.optional(),
  note: z.string().max(1000).default(''),
});
export const handoverSchema = z.object({
  kind: z.enum(['pickup', 'return']),
  mileage: z.number().int().min(0).max(9999999),
  fuel: z.enum(['Pełny', '3/4', '1/2', '1/4', 'Pusty']),
  notes: z.string().max(3000).default(''),
  checks: z.object({
    equipment: z.literal(true),
    condition: z.literal(true),
    fuel: z.literal(true),
  }),
});
export const depositSchema = z.object({
  status: z.enum(['authorized', 'released', 'claim_pending']),
  reason: z.string().min(5).max(1000),
});
