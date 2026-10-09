'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Row, useData, DataState, Empty, BookingCard } from '../../components/shared';

export function Trips({ documents = false }: { documents?: boolean }) {
  const { data, error } = useData('/bookings');
  return (
    <DataState data={data} error={error}>
      {data?.length ? (
        <div className="stack">
          {data.map((b: Row) =>
            documents ? (
              <div className="panel" key={b.id}>
                <h3>
                  {b.reference} · {b.vehicle_name}
                </h3>
                <p className="small muted">Podsumowanie rezerwacji oraz zapisane protokoły.</p>
                <Link className="btn secondary compact" href={'/konto/rezerwacja/' + b.id}>
                  Otwórz dokumenty
                </Link>
              </div>
            ) : (
              <BookingCard key={b.id} b={b} />
            ),
          )}
        </div>
      ) : (
        <Empty
          title="Twoja pierwsza podróż jest jeszcze przed Tobą."
          text="Wybierz pojazd i zarezerwuj termin. Szczegóły znajdziesz tutaj."
        >
          <Link className="btn primary" href="/pojazdy">
            Znajdź pojazd <ArrowRight size={17} />
          </Link>
        </Empty>
      )}
    </DataState>
  );
}
