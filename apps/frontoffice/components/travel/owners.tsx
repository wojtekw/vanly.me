'use client';
import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { isCamperfolks, isHeyvans } from '../../lib/brand';
import { ArrowRight } from 'lucide-react';
import { useApp, Field, Heading } from '../shared';

export function OwnersLanding() {
  const { user } = useApp();
  return (
    <div className="container section">
      <div className="content-hero">
        <div>
          <p className="eyebrow">
            {isHeyvans
              ? 'Prowadzisz wypożyczalnię?'
              : isCamperfolks
                ? 'Dla wypożyczalni kamperów i przyczep'
                : 'Dla wypożyczalni'}
          </p>
          <p>
            Pierwszy pojazd dodajesz bezpłatnie. Drugi i każdy kolejny kosztuje 200 zł jednorazowo.
            Podróżujący rezerwują bez opłat w VANLY i rozliczają najem oraz kaucję bezpośrednio z
            Tobą.
          </p>
          <h1>
            Twoja flota.
            <br />
            {isHeyvans
              ? 'Ich następny wyjazd.'
              : isCamperfolks
                ? 'Pod ręką.'
                : 'Więcej dobrych wyjazdów.'}
          </h1>
          <p>
            {isHeyvans || isCamperfolks ? (
              'Pokaż ofertę podróżnikom. Zarządzaj pojazdami, kalendarzem i rezerwacjami w panelu wypożyczalni.'
            ) : (
              <>
                Kalendarz, rezerwacje i codzienna obsługa w jednym panelu. Ustaw zasady swojego
                biznesu i pokaż ofertę podróżnikom.
              </>
            )}
          </p>
          <div className="inline">
            {!user ? (
              <>
                <Link className="btn primary" href="/rejestracja?next=%2Fdla-firm%2Frejestracja">
                  Utwórz konto <ArrowRight size={18} />
                </Link>
                <Link className="btn secondary" href="/logowanie?next=%2Fdla-firm%2Frejestracja">
                  Zaloguj się
                </Link>
              </>
            ) : (
              <Link
                className="btn primary"
                href={
                  user.role === 'owner'
                    ? '/company'
                    : user.role === 'admin'
                      ? '/operator'
                      : '/dla-firm/rejestracja'
                }
              >
                {user.role === 'owner'
                  ? 'Otwórz panel firmy'
                  : user.role === 'admin'
                    ? 'Otwórz panel operatora'
                    : 'Dodaj wypożyczalnię'}
                <ArrowRight size={18} />
              </Link>
            )}
          </div>
          {!user && <p className="small muted account-purpose">1. Konto. 2. Dane wypożyczalni.</p>}
        </div>
        <img src="/assets/owners.webp" alt="Wypożyczalnia przekazuje klucze podróżnikowi" />
      </div>
      <div className="metric-grid">
        {[
          ['Jedna flota', 'Wspólny kalendarz pojazdów'],
          ['Twoje zasady', 'Ceny, bufor i minimum dób'],
          ['Wyposażenie', 'Dostępność dodatków'],
          ['Bieżąca obsługa', 'Wiadomości, odbiory i zwroty'],
        ].map(([h, p]) => (
          <div className="metric" key={h}>
            <h3>{h}</h3>
            <p>{p}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CompanyOnboarding() {
  const { user, api, act, session } = useApp();
  const [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [created, setCreated] = useState(false);
  const submitting = useRef(false);
  const registering = user?.role === 'traveler';
  return (
    <div className="container section">
      <Link className="text-link" href="/dla-firm">
        Wróć do strony dla wypożyczalni
      </Link>
      <Heading
        eyebrow={
          !user
            ? 'Krok 1 z 2 · Konto wypożyczalni'
            : registering
              ? 'Krok 2 z 2 · Konto wypożyczalni'
              : 'Dla wypożyczalni'
        }
        title={
          !user
            ? 'Zacznij od konta.'
            : registering
              ? 'Dane wypożyczalni'
              : user.role === 'owner'
                ? created
                  ? 'Konto wypożyczalni jest gotowe.'
                  : 'Twoja wypożyczalnia'
                : 'Panel operatora'
        }
      >
        {!user
          ? 'Utwórz konto lub zaloguj się. W kolejnym kroku podasz dane wypożyczalni i uzyskasz dostęp do panelu firmy.'
          : registering
            ? 'Podaj nazwę wypożyczalni, aby uzyskać dostęp do panelu firmy. Miejsce odbioru ustawisz przy każdym pojeździe w swojej flocie. Weryfikacja będzie potrzebna do publikacji ofert.'
            : user.role === 'owner'
              ? 'W panelu firmy możesz od razu przygotować pojazdy jako szkice. Publikacja ofert będzie dostępna po weryfikacji wypożyczalni.'
              : 'Otwórz panel operatora, aby zarządzać wypożyczalniami i ofertami.'}
      </Heading>
      {(!user || registering) && (
        <ol className="signup-progress" aria-label="Zakładanie konta wypożyczalni">
          <li className={user ? 'complete' : 'active'} aria-current={!user ? 'step' : undefined}>
            <span>1</span>
            <div>
              <strong>Twoje konto</strong>
              <small>{user ? 'Gotowe' : 'Utwórz konto lub zaloguj się'}</small>
            </div>
          </li>
          <li
            className={registering ? 'active' : ''}
            aria-current={registering ? 'step' : undefined}
          >
            <span>2</span>
            <div>
              <strong>Dane wypożyczalni</strong>
              <small>Otwarcie panelu firmy</small>
            </div>
          </li>
        </ol>
      )}
      <section className="panel stack">
        {!user ? (
          <>
            <p>Po utworzeniu konta lub zalogowaniu przejdziesz od razu do danych wypożyczalni.</p>
            <div className="inline">
              <Link className="btn primary" href="/rejestracja?next=%2Fdla-firm%2Frejestracja">
                Utwórz konto
              </Link>
              <Link className="btn secondary" href="/logowanie?next=%2Fdla-firm%2Frejestracja">
                Zaloguj się
              </Link>
            </div>
          </>
        ) : user.role === 'traveler' ? (
          <form
            className="stack"
            aria-busy={busy}
            onSubmit={async (e) => {
              e.preventDefault();
              if (submitting.current) return;
              submitting.current = true;
              setBusy(true);
              try {
                await act(async () => {
                  await api('/company-onboarding', 'POST', {
                    name,
                  });
                  const updatedUser = await session();
                  if (updatedUser?.role !== 'owner')
                    throw new Error(
                      'Wypożyczalnia została zapisana. Odśwież stronę, aby otworzyć panel firmy.',
                    );
                  setCreated(true);
                }, 'Konto wypożyczalni jest gotowe. Publikacja ofert będzie dostępna po weryfikacji firmy.');
              } finally {
                submitting.current = false;
                setBusy(false);
              }
            }}
          >
            <div className="account-type-summary">
              <strong>Korzystasz ze swojego konta.</strong>
              <span>{user.email || user.name}</span>
            </div>
            <div className="form-grid">
              <Field label="Nazwa wypożyczalni">
                <input
                  className="input"
                  required
                  disabled={busy}
                  minLength={3}
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            </div>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'Zapisujemy wypożyczalnię…' : 'Utwórz konto wypożyczalni'}
            </button>
          </form>
        ) : (
          <>
            <p>
              {user.role === 'owner'
                ? 'Twoja wypożyczalnia jest już dodana. Jej dane i flotę znajdziesz w panelu firmy.'
                : 'Przejdź do panelu operatora, aby zarządzać wypożyczalniami.'}
            </p>
            {user.role === 'owner' && (
              <p>Jeśli panel poprosi o zalogowanie, użyj tego samego adresu e-mail i hasła.</p>
            )}
            <Link className="btn primary" href={user.role === 'owner' ? '/company' : '/operator'}>
              {user.role === 'owner' ? 'Otwórz panel firmy' : 'Otwórz panel operatora'}
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
