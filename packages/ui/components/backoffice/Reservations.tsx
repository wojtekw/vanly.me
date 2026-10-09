'use client';
import { useState } from 'react';
import { Row, Empty, BookingCard } from '../shared';
import {
  reservationStatus,
  reservationStatuses,
  reservationLabels,
} from '../../lib/reservation-status';

export function Reservations({ rows, prefix }: { rows: Row[]; prefix: string }) {
  const [status, setStatus] = useState('all');
  const filtered = rows.filter(
    (b) => status === 'all' || reservationStatus(b.reservation_status || b.status) === status,
  );
  return (
    <>
      <div className="section-head">
        <h2>Rezerwacje</h2>
        <select
          aria-label="Status rezerwacji"
          className="input short"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">Wszystkie statusy</option>
          {reservationStatuses.map((s) => (
            <option key={s} value={s}>
              {reservationLabels[s]}
            </option>
          ))}
        </select>
      </div>
      {filtered.length ? (
        <div className="stack">
          {filtered.map((b) => (
            <BookingCard key={b.id} b={b} prefix={prefix} />
          ))}
        </div>
      ) : (
        <Empty
          title="Brak rezerwacji w tym widoku."
          text="Nowe rezerwacje pojawią się jako niepotwierdzone i będą czekały na decyzję wypożyczalni, bez wpłaty w VANLY."
        />
      )}
    </>
  );
}
