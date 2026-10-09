'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { createRequestId } from '../../lib/request-id';
import { ArrowRight, Clock } from 'lucide-react';
import {
  useApp,
  useData,
  DataState,
  Field,
  CheckField,
  Notice,
  Heading,
  Bill,
  Badge,
  ReservationBadge,
  asset,
  money,
  date,
} from '../../components/shared';
import { Require } from '../auth/Require';

export function Checkout({ id }: { id: string }) {
  return (
    <Require>
      <CheckoutBody id={id} />
    </Require>
  );
}

function CheckoutBody({ id }: { id: string }) {
  const { user, api, act, navigate } = useApp(),
    { data: b, error, reload } = useData('/bookings/' + id);
  const [busy, setBusy] = useState(false),
    [time, setTime] = useState(Date.now()),
    [paymentKey, setPaymentKey] = useState('');
  const submitting = useRef(false);
  useEffect(() => {
    setPaymentKey(createRequestId());
    const t = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remain = b ? Math.max(0, Math.floor((Date.parse(b.hold_until) - time) / 1000)) : 0;
  return (
    <div className="container">
      <Heading eyebrow="Już prawie w drodze" title="Jeszcze kilka ustaleń i ruszamy." />
      <DataState data={b} error={error}>
        {b &&
          (b.status !== 'held' ? (
            <div className="panel section">
              <ReservationBadge status={b.reservation_status || b.status} />
              <h2>Ta rezerwacja ma już nowy status.</h2>
              <Link className="btn primary" href={'/konto/rezerwacja/' + id}>
                Otwórz szczegóły
              </Link>
            </div>
          ) : (
            <div className="checkout-layout">
              <div className="stack">
                <Notice error={remain === 0}>
                  <span className="inline">
                    <Clock size={18} />
                    {remain > 0
                      ? `Termin czeka na Ciebie jeszcze ${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')}.`
                      : 'Blokada terminu wygasła. Wróć do oferty i sprawdź dostępność.'}
                  </span>
                </Notice>
                <form
                  className="panel stack"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (submitting.current || remain === 0 || !paymentKey) return;
                    submitting.current = true;
                    const f = new FormData(e.currentTarget);
                    setBusy(true);
                    try {
                      await act(async () => {
                        await api(
                          '/bookings/' + id + '/submit',
                          'POST',
                          {
                            name: f.get('name'),
                            email: f.get('email'),
                            note: f.get('note'),
                            accept: f.get('accept') === 'on',
                          },
                          paymentKey,
                        );
                        navigate('/konto/rezerwacja/' + id);
                      }, 'Rezerwacja zapisana jako niepotwierdzona. Czeka na decyzję wypożyczalni.');
                    } finally {
                      submitting.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  <div>
                    <p className="eyebrow">1 / Podróżnik</p>
                    <h2>Kto rusza w drogę?</h2>
                  </div>
                  <div className="form-grid">
                    <Field label="Imię i nazwisko">
                      <input
                        className="input"
                        name="name"
                        defaultValue={user.name}
                        required
                        minLength={2}
                        maxLength={100}
                      />
                    </Field>
                    <Field label="E-mail kontaktowy">
                      <input
                        className="input"
                        name="email"
                        type="email"
                        defaultValue={user.email}
                        required
                        maxLength={160}
                      />
                    </Field>
                    <Field label="Wiadomość przy rezerwacji" full>
                      <textarea
                        className="input"
                        name="note"
                        maxLength={1000}
                        placeholder="O której planujesz odbiór? Czy coś powinniśmy wiedzieć?"
                      />
                    </Field>
                  </div>
                  <hr className="divider" />
                  <div>
                    <p className="eyebrow">2 / Usługi na drogę</p>
                    <h2>Wszystko ma swój status.</h2>
                    <div className="integration-options">
                      <div>
                        <strong>Ubezpieczenie podróżne</strong>
                        <p>Usługa jest obecnie niedostępna.</p>
                        <Badge status="Niedostępne" />
                      </div>
                      <div>
                        <strong>Winiety</strong>
                        <p>Usługa jest obecnie niedostępna.</p>
                        <Badge status="Niedostępne" />
                      </div>
                    </div>
                  </div>
                  <hr className="divider" />
                  <div>
                    <p className="eyebrow">3 / Bezpłatna rezerwacja</p>
                    <h2>Zarezerwuj bez wpłaty w VANLY.</h2>
                    <Notice>
                      Najem i kaucję rozliczasz bezpośrednio z wypożyczalnią. Termin i sposób
                      zapłaty ustalisz z nią według warunków najmu. VANLY nie pobiera opłaty od
                      podróżujących. Rezerwacja będzie niepotwierdzona do czasu decyzji
                      wypożyczalni.
                    </Notice>
                  </div>
                  <CheckField
                    label="Akceptuję podsumowanie i zasady tej lokalnej rezerwacji testowej."
                    name="accept"
                    required
                  />
                  <Link className="text-link" href="/o-wersji">
                    Zobacz zasady wersji lokalnej
                  </Link>
                  <button className="btn primary wide" disabled={busy || remain === 0}>
                    {busy ? 'Zapisujemy rezerwację…' : 'Zarezerwuj bez wpłaty'}
                    <ArrowRight size={18} />
                  </button>
                </form>
              </div>
              <aside className="booking-panel">
                <img className="checkout-vehicle" src={asset(b.asset)} alt={b.vehicle_name} />
                <p className="eyebrow">
                  {b.company_name} · {b.city}
                </p>
                <h3>{b.vehicle_name}</h3>
                <p className="small muted">
                  Miejsce odbioru:{' '}
                  {[b.city, [b.street, b.house_number].filter(Boolean).join(' ')]
                    .filter(Boolean)
                    .join(', ')}
                </p>
                <p className="small">
                  {date(b.start_date)} — {date(b.end_date)}
                </p>
                <p className="small muted">{b.guests} podróżników</p>
                <Bill q={b.snapshot} />
                <p className="small muted">
                  Po wysłaniu rezerwacja otrzyma status „Niepotwierdzona”. Wypożyczalnia potwierdzi
                  ją lub odrzuci.
                </p>
              </aside>
            </div>
          ))}
      </DataState>
    </div>
  );
}
