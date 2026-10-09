import { z } from 'zod';

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) &&
      new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value,
    'Nieprawidłowa data',
  );
export const day = (value: string, offset: number) =>
  new Date(Date.parse(value + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
export const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
export const days = (start: string, end: string) =>
  Math.round((Date.parse(end + 'T12:00:00Z') - Date.parse(start + 'T12:00:00Z')) / 86400000);
