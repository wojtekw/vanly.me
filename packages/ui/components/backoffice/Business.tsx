'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Row, useApp, useData, DataState, CheckField, Empty, BookingCard, Notice } from '../shared';
import { Require, Booking, Messages } from '../Account';
import { Stock } from '../Stock';
import { Shell } from './Shell';
import { Reservations } from './Reservations';
import { Fleet, VehicleForm } from './Fleet';
import { Calendar } from './Calendar';
import { SettingsForm } from './Settings';
import { Team } from './Team';
import { OwnerComments } from './Comments';

export function Business({ tab, id }: { tab: string; id?: string }) {
  return (
    <Require role="owner">
      <BusinessBody tab={tab} id={id} />
    </Require>
  );
}
function BusinessBody({ tab, id }: { tab: string; id?: string }) {
  const { api, act } = useApp(),
    { data: d, error, reload } = useData('/owner/dashboard');
  if (tab === 'rezerwacja' && id) return <Booking id={id} back="/company/bookings" mode="owner" />;
  const active =
    d?.bookings.filter((b: Row) => ['pending', 'confirmed', 'in_rental'].includes(b.status)) || [];
  return (
    <Shell tab={tab} company={d?.company}>
      <DataState data={d} error={error}>
        {d &&
          (tab === 'wiadomosci' ? (
            <Messages business />
          ) : tab === 'flota' ? (
            <Fleet d={d} reload={reload} />
          ) : tab === 'pojazd' ? (
            id && id !== 'new' && !d.vehicles.some((v: Row) => v.id === id) ? (
              <Notice error>
                Nie znaleźliśmy tego pojazdu w Twojej flocie.{' '}
                <Link href="/company/fleet">Wróć do floty</Link>.
              </Notice>
            ) : (
              <VehicleForm
                key={id || 'new'}
                vehicle={d.vehicles.find((v: Row) => v.id === id)}
                company={d.company}
                billing={d.billing}
                reload={reload}
              />
            )
          ) : tab === 'magazyn' ? (
            <Stock vehicles={d.vehicles} />
          ) : tab === 'kalendarz' ? (
            <Calendar d={d} reload={reload} />
          ) : tab === 'ustawienia' ? (
            <SettingsForm d={d} reload={reload} />
          ) : tab === 'zespol' ? (
            <Team d={d} reload={reload} />
          ) : tab === 'komentarze' ? (
            <OwnerComments />
          ) : tab === 'rezerwacje' ? (
            <Reservations rows={d.bookings} prefix="/company/booking/" />
          ) : (
            <>
              <div className="metric-grid">
                {[
                  ['Pojazdy we flocie', d.vehicles.length],
                  ['Czekają na decyzję', active.filter((b: Row) => b.status === 'pending').length],
                  ['Aktywne rezerwacje', active.length],
                  ['Do przygotowania', d.tasks.filter((t: Row) => !t.done).length],
                ].map(([h, n]) => (
                  <div className="metric" key={h}>
                    <p className="metric-label">{h}</p>
                    <strong>{n}</strong>
                  </div>
                ))}
              </div>
              <div className="panel">
                <div className="spread">
                  <h2>Co jest dziś do zrobienia?</h2>
                  <Link className="text-link" href="/company/calendar">
                    Kalendarz <ArrowRight size={16} />
                  </Link>
                </div>
                {d.tasks.length ? (
                  d.tasks.map((t: Row) => (
                    <div className="task-row" key={t.id}>
                      <CheckField
                        label={t.title}
                        checked={t.done}
                        onChange={(e) =>
                          act(async () => {
                            await api('/owner/tasks/' + t.id, 'PATCH', { done: e.target.checked });
                            reload();
                          })
                        }
                      />
                      <Link className="text-link" href={'/company/booking/' + t.booking_id}>
                        Otwórz
                      </Link>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    Po pierwszej rezerwacji pojawią się zadania przygotowania pojazdu.
                  </p>
                )}
              </div>
              <div className="section-head section-top">
                <h2>Najbliższe wyjazdy</h2>
                <Link className="text-link" href="/company/bookings">
                  Wszystkie rezerwacje <ArrowRight size={17} />
                </Link>
              </div>
              {active.length ? (
                <div className="stack">
                  {[...active]
                    .sort((a: Row, b: Row) => a.start_date.localeCompare(b.start_date))
                    .slice(0, 4)
                    .map((b: Row) => (
                      <BookingCard b={b} key={b.id} prefix="/company/booking/" />
                    ))}
                </div>
              ) : (
                <Empty
                  title="Kalendarz czeka na pierwsze wyjazdy."
                  text="Sprawdź oferty, ceny i wyposażenie, zanim pojawią się rezerwacje."
                >
                  <Link className="btn primary" href="/company/fleet">
                    Zobacz flotę
                  </Link>
                </Empty>
              )}
            </>
          ))}
      </DataState>
    </Shell>
  );
}
