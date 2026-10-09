import type { Pool, PoolClient } from 'pg';

export type BookingDb = Pool | PoolClient;
export type Timestamp = Date | string;
export type PriceUnit = 'day' | 'trip';
export type PaymentPlan = 'deposit' | 'full' | 'direct';
export type ReservationStatus = 'pending' | 'cancelled' | 'rejected' | 'confirmed';
export type BookingStatus =
  | 'held'
  | 'pending'
  | 'confirmed'
  | 'in_rental'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  | 'expired';
export type PaymentStatus =
  | 'unpaid'
  | 'partial'
  | 'paid'
  | 'refund_pending'
  | 'refunded'
  | 'external';
export type DepositStatus = 'scheduled' | 'authorized' | 'released' | 'claim_pending';

export interface CompanySettings {
  minDays?: number;
  buffer?: number;
  prep?: number;
  open?: string;
  close?: string;
  cancel?: string;
  [key: string]: unknown;
}
export interface VehicleForQuote {
  id: string;
  company_id: string;
  company_name: string;
  settings: CompanySettings;
  verified: boolean;
  publication_active: boolean;
  name: string;
  type: string;
  status: string;
  asset: string;
  city: string;
  street: string;
  house_number: string;
  lat: number | null;
  lng: number | null;
  min_days: number;
  seats: number;
  sleeps: number;
  daily: number;
  prep: number;
  deposit: number;
  instant: boolean;
  auto: boolean;
  pets: boolean;
  km: number | null;
  features: string[];
  description: string;
  tagline: string;
}
export interface QuoteInput {
  vehicleId: string;
  start: string;
  end: string;
  guests: number;
  extras: Record<string, number>;
  plan: PaymentPlan;
}
export interface QuotedExtra {
  id: string;
  name: string;
  quantity: number;
  price: number;
  unit: PriceUnit;
  total: number;
}
export interface QuoteSnapshot {
  company?: { id: string; name: string };
  companySettings?: CompanySettings;
  vehicle: VehicleForQuote;
  days: number;
  rates: { date: string; rate: number }[];
  baseMinor: number;
  prepMinor: number;
  equipmentMinor: number;
  extras: QuotedExtra[];
  totalMinor: number;
  depositMinor: number;
  buffer: number;
  plan: PaymentPlan;
  dueNowMinor: number;
  balanceDue: string | null;
  settlementMode?: 'direct' | 'local_test';
  platformFeeMinor?: number;
  currency: 'PLN';
  start: string;
  end: string;
  guests: number;
}
export interface QuoteRow {
  id: string;
  user_id: string;
  vehicle_id: string;
  input: QuoteInput;
  snapshot: QuoteSnapshot;
  expires_at: Timestamp;
  created_at: Timestamp;
}
export interface TravelerInput {
  name: string;
  email: string;
  note: string;
  accept: true;
  scenario: 'success' | 'failure';
}
export interface BookingRow {
  id: string;
  reference: string;
  user_id: string;
  company_id: string;
  vehicle_id: string;
  quote_id: string;
  start_date: string;
  end_date: string;
  guests: number;
  status: BookingStatus;
  hold_until: Timestamp | null;
  payment_status: PaymentStatus;
  payment_instructions: string;
  deposit_status: DepositStatus;
  total_minor: number;
  paid_minor: number;
  deposit_minor: number;
  buffer: number;
  snapshot: QuoteSnapshot;
  traveler: Partial<TravelerInput>;
  created_at: Timestamp;
  updated_at: Timestamp;
}
export interface AccessibleBooking extends BookingRow {
  reservation_status: ReservationStatus;
  vehicle_name: string;
  asset: string;
  company_name: string;
  city: string;
  street: string;
  house_number: string;
  has_test_payments: boolean;
}
export interface BookingExtraRow {
  booking_id: string;
  company_id: string;
  item_id: string;
  quantity: number;
  price: number;
  unit: PriceUnit;
}
export interface StockRow {
  company_id: string;
  id: string;
  name: string;
  quantity: number;
  price: number;
  unit: PriceUnit;
  active: boolean;
  excluded_types: string[];
}
export interface StockUsage {
  item_id: string;
  used: number;
}
export interface StockMinimum {
  item_id: string;
  needed: number;
}
export interface SeasonRow {
  id: string;
  start_date: string;
  end_date: string;
  rate: number;
}
export interface PaymentRow {
  id: string;
  booking_id: string;
  kind: 'payment' | 'refund';
  amount_minor: number;
  provider: string;
  status: string;
  idempotency_key: string;
  created_at: Timestamp;
}
export interface TravelServiceRow {
  id: string;
  booking_id: string;
  kind: 'insurance' | 'vignette';
  status: string;
  details: Record<string, unknown>;
  created_at: Timestamp;
}
export interface AmendmentInput {
  start: string;
  end: string;
  extras?: Record<string, number>;
  note: string;
}
export interface AmendmentRow {
  id: string;
  booking_id: string;
  requested_by: string;
  input: QuoteInput & { note: string };
  snapshot: QuoteSnapshot;
  previous: { start: string; end: string; totalMinor: number; snapshot: QuoteSnapshot } | null;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: Timestamp;
}
export interface HandoverInput {
  kind: 'pickup' | 'return';
  mileage: number;
  fuel: 'Pełny' | '3/4' | '1/2' | '1/4' | 'Pusty';
  notes: string;
  checks: { equipment: true; condition: true; fuel: true };
}
export interface HandoverRow extends HandoverInput {
  id: string;
  booking_id: string;
  created_by: string;
  confirmed: boolean;
  created_at: Timestamp;
}
export interface BookingDetail extends AccessibleBooking {
  extras: BookingExtraRow[];
  payments: PaymentRow[];
  services: TravelServiceRow[];
  amendments: AmendmentRow[];
  handovers: HandoverRow[];
}
