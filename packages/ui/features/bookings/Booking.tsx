'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { createRequestId } from '../../lib/request-id';
import { BookingHandovers } from '../../components/BookingHandovers';
import { Printer, Download } from 'lucide-react';
import {
  Row,
  useApp,
  useData,
  DataState,
  Field,
  Notice,
  Heading,
  Bill,
  Badge,
  ReservationBadge,
  asset,
  money,
  date,
  isoDay,
} from '../../components/shared';
import { Require } from '../auth/Require';
import { BookingDocuments, bookingDocumentUrl } from './BookingDocuments';

export function Booking({
  id,
  back = '/konto',
  mode = 'traveler',
}: {
  id: string;
  back?: string;
  mode?: string;
}) {
  return (
    <Require>
      <BookingBody id={id} back={back} mode={mode} />
    </Require>
  );
}

function BookingBody({ id, back, mode }: { id: string; back: string; mode: string }) {
  const { user, api, act } = useApp(),
    { data: b, error, reload } = useData('/bookings/' + id);
  const [busy, setBusy] = useState(false),
    [cancel, setCancel] = useState(false);
  const submitting = useRef(false);
  const owner = mode !== 'traveler';
  async function mutate(path: string, data?: Row, method = 'POST', success = 'Zapisano zmianę.') {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      await act(async () => {
        await api(path, method, data, createRequestId());
        reload();
      }, success);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  function downloadLegacySnapshot() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            reference: b.reference,
            vehicle: b.vehicle_name,
            company: b.company_name,
            start: b.start_date,
            end: b.end_date,
            guests: b.guests,
            status: b.reservation_status || b.status,
            payment_status: b.payment_status,
            total_minor: b.total_minor,
            paid_minor: b.paid_minor,
            deposit_minor: b.deposit_minor,
            quote: b.snapshot,
            handovers: b.handovers,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = b.reference + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function download() {
    act(async () => {
      const documents = await api('/bookings/' + id + '/documents');
      const latest = documents.find((document: Row) =>
        ['summary', 'amendment'].includes(document.kind),
      );
      if (!latest) {
        downloadLegacySnapshot();
        return;
      }
      const link = document.createElement('a');
      link.href = bookingDocumentUrl(id, latest.documentId);
      link.download = latest.fileName;
      link.click();
    });
  }
  return (
    <div className="container section">
      <Link className="text-link" href={back}>
        ← Wróć do panelu
      </Link>
      <DataState data={b} error={error}>
        {b && (
          <>
            <Heading eyebrow={b.reference} title={b.vehicle_name}>
              <div className="inline">
                <ReservationBadge status={b.reservation_status || b.status} />
                <span>
                  {b.company_name} · {b.city}
                </span>
              </div>
            </Heading>
            <div className="booking-detail-layout">
              <div className="stack">
                <section className="panel">
                  <div className="spread">
                    <h2>Podsumowanie rezerwacji.</h2>
                    <div className="inline no-print">
                      <button
                        className="icon-btn"
                        aria-label="Drukuj podsumowanie"
                        onClick={() => window.print()}
                      >
                        <Printer size={20} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="Pobierz podsumowanie"
                        onClick={download}
                      >
                        <Download size={20} />
                      </button>
                    </div>
                  </div>
                  <div className="summary-grid">
                    <div className="summary-cell">
                      <small>Miejsce odbioru</small>
                      {[b.city, [b.street, b.house_number].filter(Boolean).join(' ')]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                    <div className="summary-cell">
                      <small>Odbiór</small>
                      {date(b.start_date)}
                    </div>
                    <div className="summary-cell">
                      <small>Zwrot</small>
                      {date(b.end_date)}
                    </div>
                    <div className="summary-cell">
                      <small>Podróżnicy</small>
                      {b.guests} osoby
                    </div>
                    <div className="summary-cell">
                      <small>Osoba rezerwująca</small>
                      {b.traveler.name || user.name}
                    </div>
                  </div>
                  {b.traveler.note && <Notice>{b.traveler.note}</Notice>}
                  <div className="status-cards">
                    <div>
                      <small>Płatność za pojazd</small>
                      <Badge status={b.payment_status} />
                    </div>
                    <div>
                      <small>Kaucja</small>
                      <Badge status={b.deposit_status} />
                    </div>
                    <div>
                      <small>Usługi zewnętrzne</small>
                      <span className="pill">Niedostępne</span>
                    </div>
                  </div>
                  {!owner && b.status === 'held' && (
                    <Link className="btn primary" href={'/rezerwacja/' + id}>
                      Dokończ rezerwację
                    </Link>
                  )}
                  {b.status === 'pending' && (
                    <Notice>
                      Rezerwacja jest niepotwierdzona. Wypożyczalnia musi ją potwierdzić lub
                      odrzucić. Do tego czasu termin pozostaje zarezerwowany.
                    </Notice>
                  )}
                  {owner && user.role === 'owner' && b.status === 'pending' && (
                    <div className="inline">
                      <button
                        className="btn primary"
                        disabled={busy}
                        onClick={() => mutate('/bookings/' + id + '/decision', { accept: true })}
                      >
                        Potwierdź rezerwację
                      </button>
                      <button
                        className="btn danger"
                        disabled={busy}
                        onClick={() => mutate('/bookings/' + id + '/decision', { accept: false })}
                      >
                        Odrzuć rezerwację
                      </button>
                    </div>
                  )}
                  {!owner &&
                    b.snapshot.settlementMode !== 'direct' &&
                    ['pending', 'confirmed', 'in_rental'].includes(b.status) &&
                    b.paid_minor < b.total_minor && (
                      <button
                        className="btn primary"
                        disabled={busy}
                        onClick={() =>
                          mutate(
                            '/bookings/' + id + '/balance-test',
                            undefined,
                            'POST',
                            'Dopłatę testową zapisano.',
                          )
                        }
                      >
                        Dopłać testowo {money(b.total_minor - b.paid_minor)}
                      </button>
                    )}
                  {mode === 'admin' && b.payment_status === 'refund_pending' && (
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() =>
                        mutate(
                          '/bookings/' + id + '/refund-test',
                          undefined,
                          'POST',
                          'Zwrot testowy zapisano.',
                        )
                      }
                    >
                      Zapisz zwrot testowy
                    </button>
                  )}
                </section>
                <BookingDocuments bookingId={id} />
                {!owner && ['pending', 'confirmed'].includes(b.status) && (
                  <form
                    className="panel stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      mutate(
                        '/bookings/' + id + '/amendments',
                        { start: f.get('start'), end: f.get('end'), note: f.get('note') },
                        'POST',
                        'Propozycja zmiany czeka na decyzję firmy.',
                      );
                    }}
                  >
                    <h2>Plany się zmieniają.</h2>
                    <p className="small muted">
                      Firma sprawdzi nowy termin i cenę. Obecna rezerwacja obowiązuje do akceptacji
                      zmiany.
                    </p>
                    <div className="form-grid">
                      <Field label="Nowy odbiór">
                        <input
                          className="input"
                          type="date"
                          name="start"
                          defaultValue={b.start_date}
                          min={isoDay()}
                          required
                        />
                      </Field>
                      <Field label="Nowy zwrot">
                        <input
                          className="input"
                          type="date"
                          name="end"
                          defaultValue={b.end_date}
                          min={isoDay()}
                          required
                        />
                      </Field>
                    </div>
                    <Field label="Co chcesz ustalić?">
                      <textarea className="input" name="note" maxLength={1000} />
                    </Field>
                    <button
                      className="btn secondary"
                      disabled={busy || b.amendments.some((a: Row) => a.status === 'pending')}
                    >
                      Poproś o zmianę terminu
                    </button>
                  </form>
                )}
                {b.amendments.length > 0 && (
                  <section className="panel">
                    <h2>Historia zmian</h2>
                    {b.amendments.map((a: Row) => (
                      <div className="change-row" key={a.id}>
                        <div className="spread">
                          <strong>
                            {date(a.input.start)} — {date(a.input.end)}
                          </strong>
                          <Badge status={a.status} />
                        </div>
                        <p>
                          Nowa cena całego wyjazdu: <strong>{money(a.snapshot.totalMinor)}</strong>
                        </p>
                        {a.input.note && <p>{a.input.note}</p>}
                        {owner && a.status === 'pending' && (
                          <div className="inline">
                            <button
                              className="btn primary compact"
                              disabled={busy}
                              onClick={() =>
                                mutate('/amendments/' + a.id + '/decision', { accept: true })
                              }
                            >
                              Akceptuj nowy termin i cenę
                            </button>
                            <button
                              className="btn danger compact"
                              disabled={busy}
                              onClick={() =>
                                mutate('/amendments/' + a.id + '/decision', { accept: false })
                              }
                            >
                              Odrzuć zmianę
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </section>
                )}
                <BookingHandovers
                  key={b.id}
                  booking={b}
                  owner={owner}
                  busy={busy}
                  onSave={(data) => mutate('/bookings/' + id + '/handovers', data)}
                  onConfirm={(handoverId) => mutate('/handovers/' + handoverId + '/confirm')}
                />
                {owner && ['confirmed', 'in_rental', 'completed'].includes(b.status) && (
                  <form
                    className="panel stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      mutate('/bookings/' + id + '/deposit', {
                        status: f.get('status'),
                        reason: f.get('reason'),
                      });
                    }}
                  >
                    <h2>Kaucja · {money(b.deposit_minor)}</h2>
                    <Notice>
                      Zmieniasz status testowy. Nie blokujemy ani nie zwracamy rzeczywistych
                      środków.
                    </Notice>
                    <Field label="Nowy status">
                      <select className="input" name="status">
                        <option value="authorized">Przyjęta — test</option>
                        {b.status === 'completed' && (
                          <>
                            <option value="released">Zwolniona — test</option>
                            <option value="claim_pending">Wyjaśnianie szkody</option>
                          </>
                        )}
                      </select>
                    </Field>
                    <Field label="Uzasadnienie">
                      <textarea
                        className="input"
                        name="reason"
                        minLength={5}
                        maxLength={1000}
                        required
                      />
                    </Field>
                    <button className="btn secondary" disabled={busy}>
                      Zapisz status kaucji
                    </button>
                  </form>
                )}
                {!owner && b.status === 'completed' && (
                  <form
                    className="panel stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      mutate(
                        '/bookings/' + id + '/review',
                        { rating: Number(f.get('rating')), text: f.get('text') },
                        'POST',
                        'Opinię zapisano do moderacji.',
                      );
                    }}
                  >
                    <h2>Jak było w drodze?</h2>
                    <Field label="Twoja ocena">
                      <select className="input" name="rating">
                        {[5, 4, 3, 2, 1].map((n) => (
                          <option key={n} value={n}>
                            {n} / 5
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Opinia po wynajmie">
                      <textarea
                        className="input"
                        name="text"
                        required
                        minLength={10}
                        maxLength={2000}
                      />
                    </Field>
                    <button className="btn primary" disabled={busy}>
                      Dodaj opinię do moderacji
                    </button>
                  </form>
                )}
                <section className="panel">
                  <h2>Historia rozliczeń</h2>
                  {b.payments.length ? (
                    b.payments.map((p: Row) => (
                      <div className="bill-row ledger-row" key={p.id}>
                        <span>
                          {p.kind === 'refund' ? 'Zwrot testowy' : 'Wpłata testowa'} ·{' '}
                          {new Date(p.created_at).toLocaleString('pl-PL')}
                        </span>
                        <strong>{money(p.amount_minor)}</strong>
                      </div>
                    ))
                  ) : (
                    <p className="muted">
                      {b.snapshot.settlementMode === 'direct'
                        ? 'Najem i kaucję rozliczasz bezpośrednio z wypożyczalnią. VANLY nie rejestruje tych wpłat.'
                        : 'Jeszcze bez wpłat.'}
                    </p>
                  )}
                </section>
                {!owner && (
                  <details className="panel">
                    <summary>Zgłoś sprawę dotyczącą rezerwacji</summary>
                    <form
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        mutate(
                          '/reports',
                          {
                            bookingId: id,
                            subject: f.get('subject'),
                            description: f.get('description'),
                          },
                          'POST',
                          'Zgłoszenie zapisane.',
                        );
                      }}
                    >
                      <Field label="Temat">
                        <input
                          className="input"
                          name="subject"
                          required
                          minLength={3}
                          maxLength={120}
                        />
                      </Field>
                      <Field label="Opis">
                        <textarea
                          className="input"
                          name="description"
                          required
                          minLength={10}
                          maxLength={3000}
                        />
                      </Field>
                      <button className="btn secondary" disabled={busy}>
                        Wyślij zgłoszenie
                      </button>
                    </form>
                  </details>
                )}
                {['held', 'pending', 'confirmed'].includes(b.status) && (
                  <div className="panel no-print">
                    {cancel ? (
                      <>
                        <h3>Anulować tę rezerwację?</h3>
                        <p>
                          {b.snapshot.settlementMode === 'direct'
                            ? 'Termin wróci do dostępnych. Ewentualne rozliczenie najmu uzgodnij bezpośrednio z wypożyczalnią.'
                            : 'Termin wróci do dostępnych. Wpłata testowa przejdzie do osobnego procesu zwrotu w panelu operatora.'}
                        </p>
                        <div className="inline">
                          <button
                            className="btn danger"
                            disabled={busy}
                            onClick={() => mutate('/bookings/' + id + '/cancel')}
                          >
                            Potwierdzam anulowanie
                          </button>
                          <button className="btn secondary" onClick={() => setCancel(false)}>
                            Zachowaj rezerwację
                          </button>
                        </div>
                      </>
                    ) : (
                      <button className="text-link" onClick={() => setCancel(true)}>
                        Anuluj rezerwację
                      </button>
                    )}
                  </div>
                )}
              </div>
              <aside className="booking-panel">
                <img className="checkout-vehicle" src={asset(b.asset)} alt="" />
                <h3>{b.vehicle_name}</h3>
                <Bill q={b.snapshot} />
                {b.snapshot.settlementMode !== 'direct' && (
                  <div className="bill-row">
                    <span>Zapisane wpłaty netto</span>
                    <strong>{money(b.paid_minor)}</strong>
                  </div>
                )}
                <p className="small muted" style={{ marginTop: 18 }}>
                  Podsumowanie lokalnej rezerwacji. Nie jest fakturą, umową najmu ani polisą.
                </p>
              </aside>
            </div>
          </>
        )}
      </DataState>
    </div>
  );
}
