'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Row, useApp, Field, date, isoDay } from '../shared';

export function Calendar({ d, reload }: { d: Row; reload: () => void }) {
  const { api, act } = useApp();
  const [start, setStart] = useState(isoDay());
  const days = Array.from({ length: 28 }, (_, i) => {
    const x = new Date(start + 'T12:00:00');
    x.setDate(x.getDate() + i);
    return x.toISOString().slice(0, 10);
  });
  const bookings = d.bookings.filter((b: Row) =>
    ['held', 'pending', 'confirmed', 'in_rental', 'completed'].includes(b.status),
  );
  const shift = (n: number) => {
    const x = new Date(start + 'T12:00:00');
    x.setDate(x.getDate() + n);
    setStart(x.toISOString().slice(0, 10));
  };
  return (
    <div className="stack">
      <div className="panel">
        <div className="spread">
          <h2>Kalendarz floty</h2>
          <div className="inline">
            <button className="icon-btn" aria-label="Poprzednie 28 dni" onClick={() => shift(-28)}>
              <ChevronLeft />
            </button>
            <input
              className="input short"
              aria-label="Początek kalendarza"
              type="date"
              value={start}
              onChange={(e) => {
                if (e.target.value) setStart(e.target.value);
              }}
            />
            <button className="icon-btn" aria-label="Kolejne 28 dni" onClick={() => shift(28)}>
              <ChevronRight />
            </button>
          </div>
        </div>
        <div className="calendar-scroll">
          <table className="fleet-calendar">
            <thead>
              <tr>
                <th>Pojazd</th>
                {days.map((day) => (
                  <th key={day}>
                    {day.slice(8)}
                    <small>
                      {new Date(day + 'T12:00:00').toLocaleDateString('pl-PL', {
                        weekday: 'short',
                      })}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.vehicles.map((v: Row) => (
                <tr key={v.id}>
                  <th>{v.name}</th>
                  {days.map((day) => {
                    const b = bookings.find(
                      (b: Row) => b.vehicle_id === v.id && b.start_date <= day && b.end_date > day,
                    );
                    const buffer = bookings.some((b: Row) => {
                      const end = new Date(b.end_date + 'T12:00:00');
                      end.setDate(end.getDate() + b.buffer);
                      return (
                        b.vehicle_id === v.id &&
                        b.end_date <= day &&
                        end.toISOString().slice(0, 10) > day
                      );
                    });
                    const block = d.blocks.find((a: Row) => {
                      const range = a.occupied.replace(/[\[\)"\]]/g, '').split(',');
                      return a.vehicle_id === v.id && range[0] <= day && range[1] > day;
                    });
                    return (
                      <td
                        key={day}
                        className={b ? 'booked' : block ? 'blocked' : buffer ? 'buffer' : ''}
                        title={
                          b
                            ? b.reference
                            : block
                              ? block.reason
                              : buffer
                                ? 'Przygotowanie pojazdu'
                                : 'Dostępny'
                        }
                      >
                        {b ? (
                          <Link
                            aria-label={b.reference + ' ' + day}
                            href={'/company/booking/' + b.id}
                          >
                            ●
                          </Link>
                        ) : block ? (
                          '×'
                        ) : buffer ? (
                          '·'
                        ) : (
                          ''
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="calendar-legend">
          <span>● Rezerwacja</span>
          <span>× Serwis / blokada</span>
          <span>· Bufor przygotowania</span>
        </div>
        <p className="small muted">
          Dostępność może się zmieniać między odświeżeniami. Odśwież kalendarz, aby zobaczyć
          aktualne rezerwacje i blokady.
        </p>
        <button className="text-link" onClick={reload}>
          Odśwież kalendarz
        </button>
      </div>
      <form
        className="panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget));
          act(async () => {
            await api('/owner/blocks', 'POST', f);
            reload();
          }, 'Termin zablokowany.');
        }}
      >
        <h2>Zostaw czas na serwis.</h2>
        <div className="form-grid">
          <Field label="Pojazd">
            <select className="input" name="vehicleId">
              {d.vehicles.map((v: Row) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Powód blokady">
            <input
              className="input"
              name="reason"
              required
              minLength={3}
              maxLength={100}
              placeholder="Np. przegląd techniczny"
            />
          </Field>
          <Field label="Od">
            <input className="input" name="start" type="date" required defaultValue={isoDay(1)} />
          </Field>
          <Field label="Do (ten dzień będzie wolny)">
            <input className="input" name="end" type="date" required defaultValue={isoDay(2)} />
          </Field>
        </div>
        <button className="btn primary" disabled={!d.vehicles.length}>
          Zablokuj termin
        </button>
      </form>
      {d.blocks.length > 0 && (
        <div className="panel">
          <h2>Ręczne blokady</h2>
          {d.blocks.map((b: Row) => (
            <div className="equipment-row" key={b.id}>
              <div>
                <strong>
                  {d.vehicles.find((v: Row) => v.id === b.vehicle_id)?.name} · {b.reason}
                </strong>
                <p>{b.occupied.replace(/[\[\)"\]]/g, '').replace(',', ' — ')}</p>
              </div>
              <button
                className="btn secondary compact"
                onClick={() =>
                  act(async () => {
                    await api('/owner/blocks/' + b.id, 'DELETE');
                    reload();
                  }, 'Blokada usunięta.')
                }
              >
                Odblokuj
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
