'use client';
import { reservationStatus, reservationLabels } from '../lib/reservation-status';
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Heart,
  MapPin,
  Users,
  BedDouble,
  Check,
  Compass,
  LoaderCircle,
  AlertCircle,
} from 'lucide-react';
export type Row = Record<string, any>;
export const money = (n: number | string = 0) =>
  new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    maximumFractionDigits: 2,
  }).format(Number(n) / 100);
export const date = (s: string) =>
  s
    ? new Date(s.slice(0, 10) + 'T12:00:00').toLocaleDateString('pl-PL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '—';
export const isoDay = (n = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const asset = (name: string) =>
  name?.startsWith('/api/') ? name : '/assets/' + (name || 'caravan.svg');
export const labels: Row = {
  held: 'Termin zablokowany',
  pending: 'Oczekuje na akceptację',
  confirmed: 'Potwierdzona',
  in_rental: 'W podróży',
  completed: 'Zakończona',
  cancelled: 'Anulowana',
  rejected: 'Odrzucona',
  expired: 'Blokada wygasła',
  unpaid: 'Nieopłacona',
  partial: 'Wpłacona zaliczka',
  paid: 'Opłacona',
  refund_pending: 'Oczekuje na zwrot',
  refunded: 'Zwrócona',
  external: 'Rozliczenie z wypożyczalnią',
  waived: 'Bez opłaty',
  paid_test: 'Rozliczono testowo',
  scheduled: 'Przed odbiorem',
  authorized: 'Kaucja przyjęta — test',
  released: 'Kaucja zwolniona — test',
  claim_pending: 'Wyjaśnianie szkody',
  published: 'Opublikowana',
  hidden: 'Ukryta',
  draft: 'Szkic',
  open: 'Nowe',
  in_progress: 'W obsłudze',
  resolved: 'Rozwiązane',
  accepted: 'Zaakceptowana',
  done: 'Wykonane',
  failed: 'Błąd',
  payment: 'Wpłata testowa',
  refund: 'Zwrot testowy',
  question: 'Pytanie',
  review: 'Opinia',
};
export const types = [
  ['all', 'Wszystkie', ''],
  ['campervan', 'Campervany', 'campervan.webp'],
  ['semi', 'Półintegry', 'semi.webp'],
  ['alcove', 'Alkowy', 'alcove.webp'],
  ['offroad', 'Vany 4×4', 'offroad.webp'],
  ['trailer', 'Przyczepy', 'caravan.svg'],
];
export function Badge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={
        'pill ' +
        ([
          'confirmed',
          'paid',
          'completed',
          'published',
          'released',
          'resolved',
          'accepted',
          'done',
        ].includes(status)
          ? 'good'
          : ['cancelled', 'rejected', 'expired', 'failed'].includes(status)
            ? 'bad'
            : 'warn')
      }
    >
      {label || labels[status] || status}
    </span>
  );
}
export function ReservationBadge({ status }: { status: string }) {
  const value = reservationStatus(status);
  return <Badge status={value} label={reservationLabels[value]} />;
}
export function Field({
  label,
  children,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={'form-field ' + (full ? 'full' : '')}>
      <span>{label}</span>
      {React.Children.map(children, (child) =>
        React.isValidElement(child) &&
        ['input', 'textarea', 'select'].includes(child.type as string)
          ? React.cloneElement(child as React.ReactElement<any>, {
              'aria-label': (child.props as any)['aria-label'] || label,
            })
          : child,
      )}
    </label>
  );
}
export function CheckField({
  label,
  ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="checkbox-line">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div className={'app-notice ' + (error ? 'error' : '')} role={error ? 'alert' : undefined}>
      {error ? <AlertCircle size={18} /> : <Compass size={18} />}
      <div>{children}</div>
    </div>
  );
}
export function Empty({
  title = 'Jeszcze nic tu nie ma.',
  text = 'Wróć tutaj po zapisaniu pierwszych danych.',
  children,
}: {
  title?: string;
  text?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <Compass size={38} />
      <h2>{title}</h2>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function Loading() {
  const app = useContext(Context);
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={25} /> Ładujemy {app?.brand?.name || 'Vanly'}…
    </div>
  );
}
export const Context = createContext<any>(null);
export const useApp = () => useContext(Context);
export function useData(path: string | null, version: any = 0) {
  const { api, user } = useApp();
  const [tick, setTick] = useState(0);
  const scope = [user?.id, user?.role, user?.company_id].join(':');
  const query = useMemo(
    () => ({ path, version, tick, api, scope }),
    [path, version, tick, api, scope],
  );
  const request = useRef(query);
  request.current = query;
  const [state, setState] = useState<{ query: typeof query; data: any; error: string }>({
    query,
    data: null,
    error: '',
  });
  useEffect(() => {
    let live = true;
    setState({ query, data: null, error: '' });
    if (path)
      api(path)
        .then((d: any) => {
          if (live && request.current === query) setState({ query, data: d, error: '' });
        })
        .catch((e: Error) => {
          if (live && request.current === query) setState({ query, data: null, error: e.message });
        });
    return () => {
      live = false;
    };
  }, [query]);
  return {
    data: state.query === query ? state.data : null,
    error: state.query === query ? state.error : '',
    reload: useCallback(() => setTick((t) => t + 1), []),
  };
}
export function DataState({
  data,
  error,
  children,
}: {
  data: any;
  error: string;
  children: React.ReactNode;
}) {
  return error ? <Notice error>{error}</Notice> : data === null ? <Loading /> : <>{children}</>;
}
export function Heading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-top">
      <p className="eyebrow">{eyebrow || 'Twój kawałek drogi'}</p>
      <h1>{title}</h1>
      {children && <div className="page-intro">{children}</div>}
    </div>
  );
}
export function Card({ v, query = '' }: { v: Row; query?: string }) {
  const { user, api, act, navigate, favorites, loadFavorites } = useApp();
  const saved = favorites.some((f: Row) => f.id === v.id);
  return (
    <article className="vehicle-card">
      <Link href={'/pojazd/' + v.id + query} className="vehicle-picture">
        <img src={asset(v.asset)} alt={v.name} loading="lazy" />
        <span className="card-tag">Potwierdza wypożyczalnia</span>
      </Link>
      <button
        className={'icon-btn favorite-button ' + (saved ? 'saved' : '')}
        aria-label={saved ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}
        onClick={() => {
          if (!user) return navigate('/logowanie');
          act(
            async () => {
              await api('/favorites/' + v.id, saved ? 'DELETE' : 'POST');
              await loadFavorites();
            },
            saved ? 'Usunięto z ulubionych.' : 'Zapisano w ulubionych.',
          );
        }}
      >
        <Heart size={18} fill={saved ? 'currentColor' : 'none'} />
      </button>
      <div className="vehicle-card-body">
        <p className="eyebrow">
          {v.city} · {v.company_name}
        </p>
        <h3>
          <Link href={'/pojazd/' + v.id + query}>{v.name}</Link>
        </h3>
        <div className="vehicle-facts">
          <span>
            <Users size={15} />
            {v.type === 'trailer' ? 'Przyczepa' : v.seats + ' miejsca'}
          </span>
          <span>
            <BedDouble size={15} />
            {v.sleeps} do spania
          </span>
          <span>{v.auto ? 'Automat' : 'Manual / przyczepa'}</span>
        </div>
        <div className="card-rule" />
        <div className="spread">
          <div className="price">
            {money(v.total_minor || v.daily)}
            <small> / {v.total_minor && query ? 'wyjazd' : 'doba'}</small>
          </div>
          <Link
            className="icon-btn"
            href={'/pojazd/' + v.id + query}
            aria-label={'Zobacz ' + v.name}
          >
            <ArrowRight size={20} />
          </Link>
        </div>
        {v.review_count > 0 ? (
          <p className="tiny muted">
            {v.rating} / 5 · {v.review_count} opinii po wynajmie
          </p>
        ) : (
          <p className="tiny muted">
            {v.total_minor && query
              ? 'Cena z przygotowaniem, bez dodatków'
              : 'Pełną cenę sprawdzisz dla wybranego terminu.'}
          </p>
        )}
      </div>
    </article>
  );
}
export function Bill({ q }: { q: Row }) {
  return (
    <div className="bill">
      <div className="bill-row">
        <span>Najem · {q.days} dób</span>
        <strong>{money(q.baseMinor)}</strong>
      </div>
      <div className="bill-row">
        <span>Przygotowanie pojazdu</span>
        <strong>{money(q.prepMinor)}</strong>
      </div>
      {q.extras?.map((e: Row) => (
        <div className="bill-row" key={e.id}>
          <span>
            {e.name} × {e.quantity}
          </span>
          <strong>{money(e.total)}</strong>
        </div>
      ))}
      <div className="bill-row bill-total">
        <span>Cały wyjazd</span>
        <strong>{money(q.totalMinor)}</strong>
      </div>
      {q.settlementMode === 'direct' ? (
        <div className="bill-row">
          <span>Opłata za rezerwację w VANLY</span>
          <strong>{money(0)}</strong>
        </div>
      ) : (
        <div className="bill-row">
          <span>{q.plan === 'deposit' ? 'Zaliczka 30%' : 'Płatność pełna'}</span>
          <strong>{money(q.dueNowMinor)}</strong>
        </div>
      )}
      {q.plan === 'deposit' && (
        <div className="bill-row">
          <span>Dopłata do {date(q.balanceDue)}</span>
          <strong>{money(q.totalMinor - q.dueNowMinor)}</strong>
        </div>
      )}
      <div className="deposit-note">
        Kaucja osobno: <strong>{money(q.depositMinor)}</strong>. Rozliczana przy odbiorze i zwrocie.
        {q.settlementMode === 'direct'
          ? 'Najem i kaucję rozliczasz bezpośrednio z wypożyczalnią. VANLY nie pobiera wpłat.'
          : 'W tej instalacji wszystkie płatności i statusy kaucji są testowe.'}
      </div>
    </div>
  );
}
export function BookingCard({ b, prefix = '/konto/rezerwacja/' }: { b: Row; prefix?: string }) {
  return (
    <article className="booking-card">
      <div className="booking-card-head">
        <img src={asset(b.asset)} alt="" />
        <div>
          <p className="eyebrow">{b.reference}</p>
          <h3>{b.vehicle_name}</h3>
          <p>
            {date(b.start_date)} — {date(b.end_date)}
          </p>
          <div className="inline">
            <ReservationBadge status={b.reservation_status || b.status} />
            <Badge status={b.payment_status} />
          </div>
        </div>
        <div className="booking-price">
          <strong className="price">{money(b.total_minor)}</strong>
          <p className="small muted">Cały wyjazd</p>
        </div>
      </div>
      <Link
        className="btn secondary compact"
        href={(b.status === 'held' ? '/rezerwacja/' : prefix) + b.id}
      >
        Szczegóły rezerwacji <ArrowRight size={15} />
      </Link>
    </article>
  );
}
