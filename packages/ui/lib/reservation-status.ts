export const reservationStatuses = ['pending', 'cancelled', 'rejected', 'confirmed'] as const;
export type ReservationStatus = (typeof reservationStatuses)[number];
export const reservationLabels: Record<ReservationStatus, string> = {
  pending: 'Niepotwierdzona',
  cancelled: 'Anulowana',
  rejected: 'Odrzucona',
  confirmed: 'Potwierdzona',
};

// Hold expiry and handover progress are internal lifecycle states, not extra
// reservation statuses. Also handles historical rows and saved snapshots.
export function reservationStatus(status: string): ReservationStatus {
  if (status === 'held' || status === 'pending') return 'pending';
  if (status === 'expired' || status === 'cancelled') return 'cancelled';
  if (status === 'rejected') return 'rejected';
  if (['confirmed', 'in_rental', 'completed'].includes(status)) return 'confirmed';
  return 'pending';
}
