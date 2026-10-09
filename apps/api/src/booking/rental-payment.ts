import { z } from 'zod';
export const rentalPaymentInstructions = z
  .string()
  .trim()
  .min(10)
  .max(4000)
  .refine(
    (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    'Instrukcja zawiera niedozwolone znaki.',
  );
export const optionalRentalPaymentInstructions = z.union([
  z.literal(''),
  rentalPaymentInstructions,
]);
