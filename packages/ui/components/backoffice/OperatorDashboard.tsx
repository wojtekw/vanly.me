'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Row, Notice, Empty, BookingCard, money } from '../shared';
import { canonicalPanelPath } from '../../portal-routes.mjs';

export function OperatorDashboard({ d }: { d: Row }) {
  return (
    <>
      <div className="metric-grid">
        {[
          ['Użytkownicy', d.stats.users],
          ['Pojazdy', d.stats.vehicles],
          ['Aktywne / zakończone', d.stats.bookings],
          ['Wartość rezerwacji', money(d.stats.total_minor)],
        ].map(([h, n]) => (
          <div className="metric" key={h}>
            <p className="metric-label">{h}</p>
            <strong>{n}</strong>
          </div>
        ))}
      </div>
      <div className="operator-queues">
        {[
          ['firmy', 'Firmy do weryfikacji', d.companies.filter((c: Row) => !c.verified).length],
          [
            'moderacja',
            'Treści do moderacji',
            d.comments.filter((c: Row) => c.status === 'pending').length,
          ],
          [
            'zgloszenia',
            'Otwarte zgłoszenia',
            d.reports.filter((r: Row) => r.status !== 'resolved').length,
          ],
          [
            'rezerwacje',
            'Zwroty do obsługi',
            d.bookings.filter((b: Row) => b.payment_status === 'refund_pending').length,
          ],
        ].map(([id, title, count]) => (
          <Link className="panel spread" key={id} href={canonicalPanelPath('/operator/' + id)}>
            <div>
              <p className="eyebrow">Do przejrzenia</p>
              <h3>{title}</h3>
            </div>
            <strong className="queue-count">{count}</strong>
            <ArrowRight size={20} />
          </Link>
        ))}
      </div>
      <Notice>
        Kwoty pochodzą z rezerwacji testowych. Nie oznaczają sprzedaży ani rzeczywistych płatności.
      </Notice>
      <h2 className="section-top">Ostatnie rezerwacje</h2>
      <div className="stack section-top">
        {d.bookings.length ? (
          d.bookings
            .slice(0, 4)
            .map((b: Row) => <BookingCard key={b.id} b={b} prefix="/operator/booking/" />)
        ) : (
          <Empty
            title="Serwis jest gotowy na pierwszy test."
            text="Zarezerwuj pojazd z konta podróżnika, a wpis pojawi się w tym panelu."
          />
        )}
      </div>
    </>
  );
}
