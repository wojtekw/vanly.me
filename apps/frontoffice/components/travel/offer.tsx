'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createRequestId } from '../../lib/request-id';
import { addDays, offerDates } from '../../lib/seo-dates';
import { isHeyvans } from '../../lib/brand';
import { PhotoViewer } from '../PhotoViewer';
import { pickupAddress } from '../PickupLocation';
import { ArrowRight, MapPin, Users, BedDouble, Check, Compass } from 'lucide-react';
import {
  Row,
  useApp,
  useData,
  DataState,
  Field,
  Notice,
  Bill,
  Loading,
  asset,
  money,
  isoDay,
} from '../shared';

function calendarDate(value: string) {
  const date = new Date(value + 'T12:00:00Z');
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function rentalDateError(start: string, end: string, today: string) {
  if (!start || !end) return 'Wybierz datę odbioru i zwrotu.';
  if (!calendarDate(start) || !calendarDate(end)) return 'Sprawdź daty odbioru i zwrotu.';
  if (start < today) return 'Data odbioru nie może być w przeszłości.';
  if (end <= start) return 'Data zwrotu musi być późniejsza niż data odbioru.';
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > 60) return 'Wybierz termin do 60 dób.';
  return '';
}

export function Offer({ id }: { id: string }) {
  const { api, user, act, navigate, ready, today } = useApp(),
    params = useSearchParams();
  const currentDay = today || isoDay();
  const initialDates = offerDates(
    { start: params.get('start') || undefined, end: params.get('end') || undefined },
    currentDay,
  );
  const [{ form }, setRental] = useState<{ form: Row; durationDays: number }>(() => ({
    form: {
      start: initialDates.start,
      end: initialDates.end,
      guests: Number(params.get('guests') || 2),
      plan: 'direct',
      extras: {},
    },
    durationDays: (Date.parse(initialDates.end) - Date.parse(initialDates.start)) / 86400000,
  }));
  const dateError = rentalDateError(form.start, form.end, currentDay);
  const { data: currentVehicle, error } = useData(
    '/vehicles/' + id + (dateError ? '' : '?start=' + form.start + '&end=' + form.end),
  );
  // Keep this vehicle visible while dates are edited or availability is refreshed.
  const [lastVehicle, setLastVehicle] = useState({ id, data: currentVehicle });
  useEffect(() => {
    if (currentVehicle) setLastVehicle({ id, data: currentVehicle });
  }, [currentVehicle, id]);
  const v = currentVehicle || (lastVehicle.id === id ? lastVehicle.data : null);
  const equipmentPending = !!dateError || !currentVehicle || !!error;
  const [preview, setPreview] = useState<{ key: string; data?: Row; error?: string } | null>(null),
    [busy, setBusy] = useState(false),
    [question, setQuestion] = useState(''),
    [message, setMessage] = useState('');
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const galleryImages = v
    ? [
        {
          src: asset(v.asset),
          alt: v.name,
          caption: v.asset.startsWith('/api/')
            ? 'Zdjęcie wypożyczalni'
            : 'Ilustracja przykładowego pojazdu',
        },
        {
          src: isHeyvans ? '/assets/heyvans/heyvans-color-trail.webp' : '/assets/hero.webp',
          alt: isHeyvans
            ? 'Rowerzysta przy leśnej bazie z kamperem — fotografia koncepcyjna'
            : 'Pomysł na odpoczynek w drodze',
          caption: isHeyvans
            ? 'Fotografia koncepcyjna — nie jest zdjęciem tego pojazdu'
            : 'Inspiracja podróżnicza — nie jest zdjęciem tego pojazdu',
        },
      ]
    : [];
  const input = { vehicleId: id, ...form };
  const inputKey = JSON.stringify(input);
  const quote = !dateError && !error && preview?.key === inputKey ? preview.data : null;
  const quoteError = dateError || error || (preview?.key === inputKey ? preview.error : '');
  useEffect(() => {
    let live = true;
    setPreview(null);
    if (!ready || dateError) return;
    const t = setTimeout(
      () =>
        api('/preview-quote', 'POST', input)
          .then((d: Row) => {
            if (live) setPreview({ key: inputKey, data: d });
          })
          .catch((e: Error) => {
            if (live) setPreview({ key: inputKey, error: e.message });
          }),
      160,
    );
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [inputKey, api, ready, dateError]);
  const set = (k: string, value: any) =>
    setRental((previous) => {
      const nextForm = { ...previous.form, [k]: value };
      if (k === 'start' && calendarDate(value) && value !== previous.form.start)
        nextForm.end = addDays(value, previous.durationDays);
      const durationDays =
        calendarDate(nextForm.start) && calendarDate(nextForm.end) && nextForm.end > nextForm.start
          ? (Date.parse(nextForm.end) - Date.parse(nextForm.start)) / 86400000
          : previous.durationDays;
      return { form: nextForm, durationDays };
    });
  async function reserve() {
    if (!quote || equipmentPending || busy) return;
    if (!user) {
      navigate(
        '/logowanie?next=' +
          encodeURIComponent(
            '/pojazd/' +
              id +
              '?start=' +
              form.start +
              '&end=' +
              form.end +
              '&guests=' +
              form.guests,
          ),
      );
      return;
    }
    setBusy(true);
    await act(async () => {
      const q = await api('/quotes', 'POST', input);
      const b = await api('/holds', 'POST', { quoteId: q.id }, createRequestId());
      navigate('/rezerwacja/' + b.id);
    });
    setBusy(false);
  }
  return (
    <div className="container">
      <DataState data={v} error={v ? '' : error}>
        {v && (
          <>
            <div className="page-top">
              <div className="breadcrumbs">
                <Link href="/pojazdy">Pojazdy</Link>
                <span>/</span>
                {v.name}
              </div>
              <div className="offer-title">
                <div>
                  <p className="eyebrow">
                    {v.city} · {v.company_name}
                  </p>
                  <h1>{v.name}</h1>
                  <p className="muted">{v.tagline}</p>
                </div>
                <span className="pill good">
                  {v.instant ? 'Potwierdzenie od razu' : 'Akceptacja wypożyczalni'}
                </span>
              </div>
            </div>
            <div className="offer-gallery">
              <button
                type="button"
                className="offer-main-picture"
                aria-label={'Otwórz galerię — ' + v.name}
                onClick={() => setGalleryIndex(0)}
              >
                <img src={asset(v.asset)} alt={v.name} />
                <span className="image-caption">
                  {v.asset.startsWith('/api/')
                    ? 'Zdjęcie wypożyczalni'
                    : 'Ilustracja przykładowego pojazdu'}
                </span>
                <span className="gallery-open-hint">Zobacz galerię</span>
              </button>
              <button
                type="button"
                className="offer-lifestyle"
                aria-label={
                  isHeyvans
                    ? 'Powiększ fotografię koncepcyjną podróży'
                    : 'Powiększ ilustrację podróży'
                }
                onClick={() => setGalleryIndex(1)}
              >
                <img
                  src={isHeyvans ? '/assets/heyvans/heyvans-color-trail.webp' : '/assets/hero.webp'}
                  alt={
                    isHeyvans
                      ? 'Rowerzysta przy leśnej bazie z kamperem — fotografia koncepcyjna'
                      : 'Pomysł na odpoczynek w drodze'
                  }
                />
                <span className="image-caption">
                  {isHeyvans
                    ? 'Fotografia koncepcyjna — nie jest zdjęciem tego pojazdu.'
                    : 'Wybierz swój kierunek.'}
                </span>
              </button>
            </div>
            {galleryIndex !== null && (
              <PhotoViewer
                images={galleryImages}
                initialIndex={galleryIndex}
                title={v.name}
                onClose={() => setGalleryIndex(null)}
              />
            )}
            <div className="offer-content">
              <div>
                <nav className="offer-nav">
                  <a href="#o-pojezdzie">O pojeździe</a>
                  <a href="#wyposazenie">Wyposażenie</a>
                  <a href="#zasady">Zasady</a>
                  <a href="#pytania">Pytania i opinie</a>
                </nav>
                <section className="offer-block" id="o-pojezdzie">
                  <h2>Miejsce na Twój sposób podróżowania.</h2>
                  <p>{v.description}</p>
                  <div className="facts-grid">
                    {[
                      [
                        Users,
                        v.type === 'trailer' ? 'Przyczepa' : v.seats + ' miejsca',
                        'do jazdy',
                      ],
                      [BedDouble, v.sleeps + ' miejsca', 'do spania'],
                      [Compass, v.auto ? 'Automat' : 'Manual / przyczepa', 'skrzynia / rodzaj'],
                      [MapPin, v.km ? v.km + ' km' : 'Bez limitu', 'w cenie za dobę'],
                    ].map(([Icon, value, label]: any) => (
                      <div className="fact-box" key={label}>
                        <Icon className="icon" />
                        <strong>{value}</strong>
                        {label}
                      </div>
                    ))}
                  </div>
                </section>
                <section className="offer-block" id="wyposazenie">
                  <h2>Na pokładzie masz już…</h2>
                  <div className="features-grid">
                    {v.features.map((f: string) => (
                      <span key={f}>
                        <Check size={17} />
                        {f}
                      </span>
                    ))}
                  </div>
                  <h2 style={{ marginTop: 30 }}>Dobierz to, co Ci się przyda.</h2>
                  <p>
                    Wyposażenie jest wspólne dla floty {v.company_name}. Dostępność sprawdzamy dla
                    wybranego terminu.
                  </p>
                  {v.equipment.map((e: Row) => {
                    const incompatible = e.excluded_types.includes(v.type);
                    return (
                      <div className="equipment-row" key={e.id}>
                        <div>
                          <h3>{e.name}</h3>
                          <p>
                            {money(e.price)} / {e.unit === 'day' ? 'szt. i dobę' : 'szt. za wyjazd'}{' '}
                            ·{' '}
                            {incompatible
                              ? 'Niedostępne do tego pojazdu'
                              : equipmentPending
                                ? dateError
                                  ? 'Wybierz poprawny termin'
                                  : error
                                    ? 'Nie udało się sprawdzić dostępności'
                                    : 'Sprawdzamy dostępność…'
                                : Math.max(0, e.available) + ' szt. dostępnych'}
                          </p>
                        </div>
                        <select
                          className="input qty"
                          aria-label={e.name + ' — liczba sztuk'}
                          disabled={incompatible || equipmentPending}
                          value={form.extras[e.id] || 0}
                          onChange={(ev) =>
                            set('extras', { ...form.extras, [e.id]: Number(ev.target.value) })
                          }
                        >
                          {Array.from(
                            {
                              length:
                                Math.min(20, Math.max(e.available, form.extras[e.id] || 0)) + 1,
                            },
                            (_, n) => (
                              <option key={n}>{n}</option>
                            ),
                          )}
                        </select>
                      </div>
                    );
                  })}
                </section>
                <section className="offer-block" id="zasady">
                  <h2>Ustalmy to przed drogą.</h2>
                  <div className="summary-grid">
                    <div className="summary-cell">
                      <small>Minimum najmu</small>
                      {Math.max(v.min_days, v.settings.minDays)} doby
                    </div>
                    <div className="summary-cell">
                      <small>Odbiór i zwrot</small>
                      {v.settings.open}–{v.settings.close}
                    </div>
                    <div className="summary-cell">
                      <small>Kaucja osobno</small>
                      {money(v.deposit)}
                    </div>
                    <div className="summary-cell">
                      <small>Podróż z psem</small>
                      {v.pets ? 'Tak' : 'Nie'}
                    </div>
                  </div>
                  <p style={{ marginTop: 20 }}>
                    Miejsce odbioru: {pickupAddress(v)}. Szczegóły odbioru potwierdzisz z
                    wypożyczalnią w wiadomości.
                  </p>
                  {v.type === 'trailer' && (
                    <Notice>
                      Przed wynajmem przyczepy potwierdź z firmą zgodność samochodu holującego i
                      wymagane uprawnienia.
                    </Notice>
                  )}
                  <Link href="/o-wersji" className="text-link">
                    Warunki tej lokalnej wersji
                  </Link>
                </section>
                <section className="offer-block" id="pytania">
                  <h2>Pytania i opinie podróżników.</h2>
                  {v.comments.length ? (
                    v.comments.map((c: Row) => (
                      <div key={c.id} className="comment-entry">
                        <strong>{c.author}</strong>
                        <span className="tiny muted">
                          {' '}
                          · {c.type === 'review' ? c.rating + ' / 5 · po wynajmie' : 'Pytanie'}
                        </span>
                        <p>{c.text}</p>
                        {c.reply && (
                          <div className="reply">
                            <strong>{v.company_name}</strong>
                            <p>{c.reply}</p>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p>Nie ma jeszcze opublikowanych pytań ani opinii.</p>
                  )}
                  {user ? (
                    <form
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act(async () => {
                          await api('/vehicles/' + id + '/questions', 'POST', { text: question });
                          setQuestion('');
                        }, 'Pytanie zapisano. Pojawi się po moderacji.');
                      }}
                    >
                      <Field label="Zadaj publiczne pytanie">
                        <textarea
                          className="input"
                          required
                          minLength={5}
                          maxLength={1500}
                          value={question}
                          onChange={(e) => setQuestion(e.target.value)}
                        />
                      </Field>
                      <button className="btn secondary" type="submit">
                        Wyślij pytanie do moderacji
                      </button>
                    </form>
                  ) : (
                    <Link className="btn secondary" href={'/logowanie?next=/pojazd/' + id}>
                      Zaloguj się, aby zapytać
                    </Link>
                  )}
                </section>
                <section className="offer-block">
                  <h2>Porozmawiaj z {v.company_name}.</h2>
                  {user ? (
                    <form
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act(async () => {
                          await api('/messages', 'POST', { vehicleId: id, text: message });
                          setMessage('');
                        }, 'Wiadomość zapisano w rozmowie.');
                      }}
                    >
                      <Field label="Prywatna wiadomość do wypożyczalni">
                        <textarea
                          className="input"
                          required
                          maxLength={3000}
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                        />
                      </Field>
                      <button className="btn secondary">Wyślij wiadomość</button>
                    </form>
                  ) : (
                    <Link className="text-link" href={'/logowanie?next=/pojazd/' + id}>
                      Zaloguj się i napisz do firmy <ArrowRight size={16} />
                    </Link>
                  )}
                </section>
              </div>
              <aside className="booking-panel">
                <p className="eyebrow">Zacznij od terminu</p>
                <div className="price">
                  {money(v.daily)} <small>/ doba poza sezonem</small>
                </div>
                <div className="form-grid booking-dates">
                  <Field label="Odbiór">
                    <input
                      className="input"
                      type="date"
                      min={currentDay}
                      required
                      aria-invalid={!!dateError}
                      value={form.start}
                      onChange={(e) => set('start', e.target.value)}
                    />
                  </Field>
                  <Field label="Zwrot">
                    <input
                      className="input"
                      type="date"
                      min={addDays(
                        calendarDate(form.start) && form.start >= currentDay
                          ? form.start
                          : currentDay,
                        1,
                      )}
                      required
                      aria-invalid={!!dateError}
                      value={form.end}
                      onChange={(e) => set('end', e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Liczba podróżników">
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max={v.sleeps}
                    value={form.guests}
                    onChange={(e) => set('guests', Number(e.target.value))}
                  />
                </Field>
                <Notice>
                  Rezerwacja w VANLY jest bezpłatna. Najem i kaucję rozliczasz bezpośrednio z
                  wypożyczalnią.
                </Notice>
                {quoteError ? (
                  <Notice error>{quoteError}</Notice>
                ) : quote ? (
                  <Bill q={quote} />
                ) : (
                  <Loading />
                )}
                <button
                  className="btn primary wide"
                  onClick={reserve}
                  disabled={!quote || equipmentPending || busy}
                >
                  {busy ? 'Blokujemy termin…' : 'Przejdź do rezerwacji'}
                  <ArrowRight size={18} />
                </button>
                <p className="small muted" style={{ marginTop: 14 }}>
                  Po przejściu dalej zachowamy termin przez 15 minut. Zatwierdzisz rezerwację bez
                  wpłaty w VANLY.
                </p>
              </aside>
            </div>
          </>
        )}
      </DataState>
    </div>
  );
}
