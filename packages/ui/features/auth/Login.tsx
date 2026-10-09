'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { useApp, Field, Notice } from '../../components/shared';
import { canonicalPanelPath } from '../../portal-routes.mjs';

export function Login({ register = false }: { register?: boolean }) {
  const { api, act, session, navigate, notify, user, brand, authAudience, authReturnTo } = useApp(),
    params = useSearchParams();
  const requestedNext = params.get('next') || authReturnTo || '/konto';
  const next =
    requestedNext.startsWith('/') &&
    !requestedNext.startsWith('//') &&
    !/[\\\u0000-\u0020]/.test(requestedNext)
      ? canonicalPanelPath(requestedNext)
      : '/konto';
  const companyPath = '/dla-firm/rejestracja';
  const companyContinuation =
    next === companyPath || next === '/company' || next.startsWith('/company/');
  const [busy, setBusy] = useState(false),
    [forgot, setForgot] = useState(false),
    [purpose, setPurpose] = useState<'traveler' | 'rental'>(
      companyContinuation ? 'rental' : 'traveler',
    );
  const submitting = useRef(false);
  useEffect(() => {
    setPurpose(companyContinuation ? 'rental' : 'traveler');
  }, [companyContinuation, register]);
  const companyIntent = register
    ? purpose === 'rental'
    : companyContinuation || authAudience === 'owner';
  const continuation = register
    ? purpose === 'rental'
      ? companyPath
      : companyContinuation
        ? '/konto'
        : next
    : next;
  const switchNext = companyIntent ? companyPath : continuation;
  const accountHome =
    user?.role === 'owner' ? '/company' : user?.role === 'admin' ? '/operator' : '/konto';
  const existingAccountTarget =
    companyIntent && user?.role === 'traveler' ? companyPath : accountHome;
  return (
    <div className="auth-layout container">
      <div className="auth-art">
        <p className="eyebrow">Dobrze Cię widzieć</p>
        <h1>
          {companyIntent
            ? 'Twoja flota.'
            : brand?.id === 'heyvans'
              ? 'Twoja baza.'
              : brand?.id === 'camperfolks'
                ? 'Dobrze mieć'
                : 'Twoje plany.'}
          <br />
          {companyIntent
            ? 'Twoja wypożyczalnia.'
            : brand?.id === 'heyvans'
              ? 'Twój następny ruch.'
              : brand?.id === 'camperfolks'
                ? 'dokąd wracać.'
                : 'Twoja droga.'}
        </h1>
        <img
          src={
            companyIntent
              ? '/assets/owners.webp'
              : brand?.id === 'heyvans'
                ? '/assets/heyvans/heyvans-color-trail.webp'
                : brand?.id === 'camperfolks'
                  ? '/assets/guides/01-pierwszy-wyjazd.webp'
                  : '/assets/trip.webp'
          }
          alt={
            companyIntent
              ? 'Wypożyczalnia przekazuje klucze podróżnikowi'
              : brand?.id === 'heyvans'
                ? 'Rowerzysta przy leśnej bazie z kamperem — fotografia koncepcyjna'
                : brand?.id === 'camperfolks'
                  ? 'Para planuje wspólną podróż przy kamperze — ilustracja'
                  : 'Wypoczynek w otoczeniu natury'
          }
        />
        <p>
          {companyIntent
            ? 'Pojazdy, kalendarz i obsługa rezerwacji w panelu Twojej wypożyczalni.'
            : 'Oferty, rozmowy i wszystko o Twoim wyjeździe — pod ręką.'}
        </p>
      </div>
      <div className="panel auth-form">
        <h2>
          {forgot
            ? 'Wróć do swojego konta.'
            : register
              ? user
                ? `Masz już konto w ${brand?.name || 'Vanly'}.`
                : companyIntent
                  ? 'Utwórz konto wypożyczalni.'
                  : 'Utwórz konto podróżującego.'
              : companyIntent
                ? 'Zaloguj się do konta wypożyczalni.'
                : `Zaloguj się do ${brand?.name || 'Vanly'}.`}
        </h2>
        {register && !user && (
          <fieldset className="registration-purpose" disabled={busy}>
            <legend>Jak chcesz korzystać z {brand?.name || 'Vanly'}?</legend>
            <div className="registration-purpose-options">
              <label>
                <input
                  type="radio"
                  name="accountPurpose"
                  value="traveler"
                  checked={purpose === 'traveler'}
                  onChange={() => setPurpose('traveler')}
                />
                <span>
                  <strong>Podróżujący</strong>
                  <small>Chcę wynająć kampera.</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="accountPurpose"
                  value="rental"
                  checked={purpose === 'rental'}
                  onChange={() => setPurpose('rental')}
                />
                <span>
                  <strong>Wypożyczalnia</strong>
                  <small>Chcę dodać pojazdy.</small>
                </span>
              </label>
            </div>
          </fieldset>
        )}
        {companyIntent && !forgot && !user && (
          <div className="account-purpose">
            {register ? (
              <>
                <ol className="signup-progress" aria-label="Rejestracja wypożyczalni">
                  <li className="active" aria-current="step">
                    <span>1</span>
                    <div>
                      <strong>Twoje konto</strong>
                      <small>Teraz</small>
                    </div>
                  </li>
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Dane wypożyczalni</strong>
                      <small>Następny krok</small>
                    </div>
                  </li>
                </ol>
                <p className="small">
                  Po utworzeniu konta podasz dane firmy, aby uzyskać dostęp do panelu wypożyczalni.
                </p>
              </>
            ) : (
              <p className="small">
                Użyj tego samego adresu e-mail i hasła.{' '}
                {companyContinuation && 'Po zalogowaniu dokończysz dane wypożyczalni.'}
              </p>
            )}
          </div>
        )}
        {user && (
          <Notice>
            Jesteś zalogowany jako {user.name}.{' '}
            <Link className="text-link" href={existingAccountTarget}>
              {companyIntent && user.role === 'traveler'
                ? 'Dokończ rejestrację wypożyczalni'
                : user.role === 'owner'
                  ? 'Otwórz panel firmy'
                  : user.role === 'admin'
                    ? 'Otwórz panel operatora'
                    : 'Przejdź do konta'}
            </Link>
            {!companyIntent && user.role === 'traveler' && (
              <p className="small">
                Chcesz dodać pojazdy?{' '}
                <Link className="text-link" href={companyPath}>
                  Dodaj wypożyczalnię do tego konta
                </Link>
                .
              </p>
            )}
          </Notice>
        )}
        {!(register && user) && (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              if (submitting.current) return;
              submitting.current = true;
              const d = Object.fromEntries(new FormData(e.currentTarget));
              setBusy(true);
              try {
                await act(
                  async () => {
                    if (forgot) {
                      const r = await api('/auth/forgot', 'POST', { email: d.email });
                      notify(r.message);
                      setForgot(false);
                      return r;
                    }
                    await api('/auth/' + (register ? 'register' : 'login'), 'POST', d);
                    const u = await session();
                    navigate(
                      continuation !== '/konto'
                        ? continuation
                        : u.role === 'owner'
                          ? '/company'
                          : u.role === 'admin'
                            ? '/operator'
                            : '/konto',
                    );
                  },
                );
              } finally {
                submitting.current = false;
                setBusy(false);
              }
            }}
          >
            {register && !forgot && (
              <Field label="Jak masz na imię?">
                <input
                  className="input"
                  name="name"
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="name"
                />
              </Field>
            )}
            <Field label="Adres e-mail">
              <input
                className="input"
                name="email"
                type="email"
                required
                autoComplete="email"
                maxLength={160}
              />
            </Field>
            {!forgot && (
              <Field label="Hasło">
                <input
                  className="input"
                  name="password"
                  type="password"
                  required
                  minLength={10}
                  maxLength={128}
                  autoComplete={register ? 'new-password' : 'current-password'}
                />
                <small className="input-help">Co najmniej 10 znaków.</small>
              </Field>
            )}
            {register && !forgot && (
              <p className="small muted auth-legal">
                Przed utworzeniem konta zapoznaj się z{' '}
                <Link className="text-link" href="/regulamin">
                  regulaminem serwisu
                </Link>{' '}
                i{' '}
                <Link className="text-link" href="/polityka-prywatnosci">
                  polityką prywatności
                </Link>
                .
              </p>
            )}
            <button className="btn primary wide" disabled={busy}>
              {busy
                ? 'Chwila…'
                : forgot
                  ? 'Poproś o link do resetu'
                  : register
                    ? companyIntent
                      ? 'Dalej — dane wypożyczalni'
                      : 'Utwórz konto'
                    : 'Zaloguj się'}
              <ArrowRight size={17} />
            </button>
          </form>
        )}
        {!register && (
          <button
            className="text-link auth-forgot"
            disabled={busy}
            onClick={() => setForgot(!forgot)}
          >
            {forgot ? 'Wróć do logowania' : 'Nie pamiętam hasła'}
          </button>
        )}
        <hr className="divider" />
        <p className="small">
          {register ? 'Masz już konto?' : `Pierwszy raz w ${brand?.name || 'Vanly'}?`}{' '}
          <Link
            className="text-link"
            href={
              (register ? '/logowanie' : '/rejestracja') + '?next=' + encodeURIComponent(switchNext)
            }
          >
            {register ? 'Zaloguj się' : 'Utwórz konto'}
          </Link>
        </p>
      </div>
    </div>
  );
}
