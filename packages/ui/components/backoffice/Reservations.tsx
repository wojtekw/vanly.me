'use client';
import { useState } from 'react';
import { Row, Empty, BookingCard } from '../shared';

export function Reservations({ rows, prefix }: { rows: Row[]; prefix: string }) {
  const [status, setStatus] = useState('all');
  const filtered = rows.filter((b) => status === 'all' || b.status === status);
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
          {['pending', 'confirmed', 'in_rental', 'completed', 'cancelled', 'rejected'].map((s) => (
            <option key={s} value={s}>
              {
                {
                  pending: 'Do akceptacji',
                  confirmed: 'Potwierdzone',
                  in_rental: 'W podróży',
                  completed: 'Zakończone',
                  cancelled: 'Anulowane',
                  rejected: 'Odrzucone',
                }[s]
              }
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
          text="Nowe rezerwacje pojawią się po zatwierdzeniu przez podróżującego, bez wpłaty w VANLY."
        />
      )}
    </>
  );
}
