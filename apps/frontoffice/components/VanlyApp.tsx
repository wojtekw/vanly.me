'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Heart, Menu, X, LogOut, UserRound, ArrowRight, Compass } from 'lucide-react';
import { Context, Row, asset, Notice, Loading, Empty } from './shared';
import {
  Home,
  Search,
  Offer,
  Content,
  OwnersLanding,
  CompanyOnboarding,
  Favorites,
  Compare,
} from './Travel';
import { Camps, MapsPrivacy } from './Camps';
import { Login, Account, Checkout, Booking, Reset } from './Account';
import { ServiceInfo } from './ServiceInfo';
import { EmailConfirmation } from './EmailConfirmation';
import { serviceInfoPages, serviceInfoKindForPath } from '../lib/service-info';
import { brand, isCamperfolks, isHeyvans } from '../lib/brand';
import { ownerOrigin, adminOrigin } from '../lib/panel-origins';
import { canonicalPanelPath, isPanelPath } from '../../../packages/ui/portal-routes.mjs';
type VanlyAppProps = {
  initialData?: Record<string, any>;
  publicPage?: boolean;
  today?: string;
  missingPage?: boolean;
};

export default function VanlyApp(props: VanlyAppProps) {
  // The static Next 404 page has no pathname during prerendering. Keep its shell
  // renderable without JavaScript rather than suspending on usePathname().
  return props.missingPage ? <VanlyAppView {...props} path="/" /> : <RoutedVanlyApp {...props} />;
}

function RoutedVanlyApp(props: VanlyAppProps) {
  const path = usePathname() || '/';
  return <VanlyAppView {...props} path={path} />;
}

function VanlyAppView({
  path,
  initialData = {},
  publicPage = false,
  today,
  missingPage = false,
}: VanlyAppProps & { path: string }) {
  const serviceInfoKind = serviceInfoKindForPath(path);
  const router = useRouter();
  const [user, setUser] = useState<Row | null>(null),
    [ready, setReady] = useState(false),
    [favorites, setFavorites] = useState<Row[]>([]),
    [menu, setMenu] = useState(false),
    [notice, setNotice] = useState<any>(null);
  const csrf = useRef('');
  const mounted = useRef(true);
  const api = useCallback(async (p: string, method = 'GET', body?: any, key?: string) => {
    const headers: Record<string, string> = {};
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') headers['x-csrf-token'] = csrf.current;
    if (key) headers['Idempotency-Key'] = key;
    const res = await fetch('/api/v1' + p, {
      method,
      headers,
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({ message: 'Serwis jest chwilowo niedostępny.' }));
    if (!res.ok) throw new Error(data.message || 'Nie udało się zapisać danych.');
    return data;
  }, []);
  const session = useCallback(async () => {
    const s = await api('/auth/me');
    csrf.current = s.csrf || '';
    setUser(s.user);
    return s.user;
  }, [api]);
  const loadFavorites = useCallback(async () => {
    try {
      setFavorites(await api('/favorites'));
    } catch {
      setFavorites([]);
    }
  }, [api]);
  const act = useCallback(async (fn: () => Promise<any>, message?: string) => {
    try {
      const r = await fn();
      if (message) setNotice({ text: message });
      return r;
    } catch (e: any) {
      setNotice({ text: e.message || 'Nie udało się wykonać tej czynności.', error: true });
      return undefined;
    }
  }, []);
  useEffect(() => {
    session()
      .catch(() =>
        setNotice({
          text: 'Nie udało się połączyć z serwerem. Odśwież stronę za chwilę.',
          error: true,
        }),
      )
      .finally(() => setReady(true));
  }, [session]);
  useEffect(() => {
    if (user) loadFavorites();
    else setFavorites([]);
  }, [user?.id, loadFavorites]);
  useEffect(() => {
    setMenu(false);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [path]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  const context = {
    brand,
    api,
    initialData,
    today,
    user,
    setUser,
    ready,
    session,
    act,
    notify: (text: string) => setNotice({ text }),
    navigate: (p: string) => {
      const target = isPanelPath(p) ? canonicalPanelPath(p) : p;
      if (isPanelPath(target))
        window.location.assign(
          (target.split(/[/?#]/)[1] === 'company' ? ownerOrigin : adminOrigin) + target,
        );
      else router.push(p);
    },
    favorites,
    loadFavorites,
  };
  const parts = path.split('/').filter(Boolean);
  let page: React.ReactNode;
  if (missingPage)
    page = (
      <div className="container section">
        <Empty title="Ta droga się tu kończy." text="Nie znaleźliśmy tej strony.">
          <Link className="btn primary" href="/">
            Wróć na start
          </Link>
        </Empty>
      </div>
    );
  else if (path === '/') page = <Home />;
  else if (path === '/pojazdy') page = <Search />;
  else if (parts[0] === 'pojazd') page = <Offer id={parts[1]} />;
  else if (['logowanie', 'rejestracja'].includes(parts[0]))
    page = <Login register={parts[0] === 'rejestracja'} />;
  else if (parts[0] === 'reset') page = <Reset />;
  else if (path === '/potwierdz-email') page = <EmailConfirmation kind="email" />;
  else if (path === '/newsletter/potwierdz') page = <EmailConfirmation kind="newsletter" />;
  else if (path === '/newsletter/rezygnacja') page = <EmailConfirmation kind="unsubscribe" />;
  else if (parts[0] === 'rezerwacja') page = <Checkout id={parts[1]} />;
  else if (parts[0] === 'konto' && parts[1] === 'rezerwacja') page = <Booking id={parts[2]} />;
  else if (parts[0] === 'konto') page = <Account tab={parts[1] || 'podroze'} />;
  else if (parts[0] === 'firma') page = <Loading />;
  else if (parts[0] === 'operator') page = <Loading />;
  else if (parts[0] === 'ulubione') page = <Favorites />;
  else if (parts[0] === 'porownaj') page = <Compare />;
  else if (parts[0] === 'kempingi') page = <Camps />;
  else if (parts[0] === 'mapy-i-prywatnosc') page = <MapsPrivacy />;
  else if (serviceInfoKind) page = <ServiceInfo kind={serviceInfoKind} />;
  else if (path === '/dla-firm/rejestracja') page = <CompanyOnboarding />;
  else if (parts[0] === 'dla-firm') page = <OwnersLanding />;
  else if (['odkrywaj', 'poradniki', 'artykul'].includes(parts[0]))
    page = <Content kind={parts[0]} id={parts[1]} />;
  else if (parts[0] === 'o-wersji')
    page = (
      <div className="container section">
        <h1>Jak działa ta wersja {brand.name}.</h1>
        <div className="panel stack" style={{ marginTop: 28 }}>
          <p>
            Oferty pojazdów i wypożyczalnie są przykładowe. Rezerwacje i płatności służą do
            testowania serwisu. Kempingi możesz sprawdzić bezpośrednio w Google Maps.
          </p>
          <Notice>
            Płatności i zwroty są testowe — nie pobieramy ani nie zwracamy prawdziwych pieniędzy.
            Sposób doręczenia powiadomień zależy od konfiguracji tej instalacji. Ubezpieczenia,
            winiety, wypłaty i logowanie przez Google są niedostępne.
          </Notice>
          <p>
            Rezerwacja testowa pozwala sprawdzić dostępność, blokadę terminu, akceptację firmy i
            protokół odbioru oraz zwrotu — bez wpłaty w VANLY.
          </p>
          <p>
            Najem i kaucję rozliczasz bezpośrednio z wypożyczalnią. VANLY nie pobiera opłat od
            podróżujących. Pierwszy pojazd wypożyczalni jest bezpłatny, drugi i każdy kolejny
            kosztuje 1 Credit za miesiąc publikacji. 1 Credit = 200 zł. Zakup Creditsów na UAT jest symulowany.
          </p>
          <Link className="text-link" href="/">
            Wróć do {brand.name} <ArrowRight size={18} />
          </Link>
        </div>
      </div>
    );
  else
    page = (
      <div className="container section">
        <Empty title="Ta droga się tu kończy." text="Nie znaleźliśmy tej strony.">
          <Link className="btn primary" href="/">
            Wróć na start
          </Link>
        </Empty>
      </div>
    );
  return (
    <Context.Provider value={context}>
      <a href="#main" className="skip-link">
        Przejdź do treści
      </a>
      <div className="local-ribbon" data-nosnippet>
        <span className="status-dot" />
        Wersja lokalna <span className="ribbon-divider">·</span> Płatności testowe{' '}
        <Link href="/o-wersji">O tej wersji</Link>
      </div>
      <header id="header">
        <div className="container site-header">
          <Link href="/" className="brand" aria-label={brand.name + ' — strona główna'}>
            <img
              src={brand.logoDark}
              alt={brand.id !== 'vanly' ? brand.name : brand.wordmark + ' — ' + brand.tagline}
              width={brand.logoWidth}
              height={brand.logoHeight}
            />
          </Link>
          <nav className={'main-nav ' + (menu ? 'is-open' : '')} aria-label="Menu główne">
            <Link href="/pojazdy">
              {isCamperfolks || isHeyvans ? 'Kampery i przyczepy' : 'Znajdź kampera'}
            </Link>
            <Link href="/odkrywaj">
              {isCamperfolks || isHeyvans ? 'Pomysły na wyjazd' : 'Odkrywaj'}
            </Link>
            <Link href="/kempingi">{isCamperfolks ? 'Miejsca na nocleg' : 'Kempingi'}</Link>
            <Link href="/poradniki">Poradniki</Link>
            <Link href="/dla-firm">Dla wypożyczalni</Link>
          </nav>
          <div className="header-actions">
            <Link href="/ulubione" className="icon-btn" aria-label="Ulubione">
              <Heart size={21} />
              {favorites.length > 0 && <span className="count-badge">{favorites.length}</span>}
            </Link>
            {user ? (
              <>
                <Link
                  className="header-account"
                  href={
                    user.role === 'owner'
                      ? ownerOrigin + '/company'
                      : user.role === 'admin'
                        ? adminOrigin + '/operator'
                        : '/konto'
                  }
                >
                  <UserRound size={17} />
                  <span>
                    {user.role === 'owner'
                      ? 'Panel firmy'
                      : user.role === 'admin'
                        ? 'Panel operatora'
                        : 'Moje konto'}
                  </span>
                </Link>
                <button
                  className="icon-btn logout"
                  aria-label="Wyloguj"
                  onClick={() =>
                    act(async () => {
                      await api('/auth/logout', 'POST');
                      await session();
                      router.push('/');
                    }, 'Wylogowano.')
                  }
                >
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <Link className="btn primary compact" href="/logowanie">
                Zaloguj się
              </Link>
            )}
            <button
              className="mobile-menu icon-btn"
              aria-label={menu ? 'Zamknij menu' : 'Otwórz menu'}
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>
      {notice && (
        <div
          className={'toast ' + (notice.error ? 'error' : '')}
          role={notice.error ? 'alert' : 'status'}
        >
          <span>{notice.text}</span>
          <button aria-label="Zamknij komunikat" onClick={() => setNotice(null)}>
            <X size={18} />
          </button>
        </div>
      )}
      <main id="main" key={path}>
        {publicPage || ready ? page : <Loading />}
      </main>
      <footer className="site-footer">
        <div className="container footer-content">
          <div className="footer-top">
            <div>
              <img
                className="footer-logo"
                src={isHeyvans ? brand.logoDark : brand.logoLight}
                alt={brand.id !== 'vanly' ? brand.name : brand.wordmark + ' — ' + brand.tagline}
                width={brand.logoWidth}
                height={brand.logoHeight}
              />
              <p className="footer-copy">
                {isHeyvans ? (
                  <span className="footer-tagline">Hej, po przygodę.</span>
                ) : isCamperfolks ? (
                  <span className="footer-tagline">Do zobaczenia w drodze.</span>
                ) : (
                  'Dobre wyjazdy zaczynają się od swobody.'
                )}
                {brand.id === 'vanly' && <br />}
                {isHeyvans
                  ? 'Kampery i przyczepy do wynajęcia. Pomysły na wyjazd, poradniki i miejsca na nocleg.'
                  : isCamperfolks
                    ? 'Kamperem, z przyczepą albo pod namiot. Weź dobry pomysł i ruszaj po swojemu.'
                    : 'Znajdź pojazd. Wybierz kierunek. Jedź po swoje.'}
              </p>
            </div>
            <div className="footer-links">
              <div>
                <strong>{isHeyvans ? 'Na wyjazd' : 'W drogę'}</strong>
                <Link href="/pojazdy">Kampery i przyczepy</Link>
                <Link href="/kempingi">Miejsca na nocleg</Link>
                <Link href="/odkrywaj">Pomysły na wyjazd</Link>
                {(isCamperfolks || isHeyvans) && <Link href="/poradniki">Poradniki</Link>}
              </div>
              <div>
                <strong>Pod ręką</strong>
                <Link href="/konto">Moje podróże</Link>
                {isHeyvans && <Link href="/ulubione">Ulubione</Link>}
                <Link href="/dla-firm">Dla wypożyczalni</Link>
                <Link href="/pomoc">Pomoc</Link>
                <Link href="/kontakt">Kontakt</Link>
              </div>
            </div>
          </div>
          <nav className="footer-information" aria-label="Dokumenty serwisu">
            <Link href={serviceInfoPages.terms.path}>{serviceInfoPages.terms.title}</Link>
            <Link href={serviceInfoPages.privacy.path}>{serviceInfoPages.privacy.title}</Link>
            <Link href={serviceInfoPages.cookies.path}>{serviceInfoPages.cookies.title}</Link>
            <Link href="/mapy-i-prywatnosc">Mapy i prywatność</Link>
            <Link href="/o-wersji">O serwisie</Link>
          </nav>
          <div className="footer-bottom" data-nosnippet>
            <span>
              © {new Date().getFullYear()} {brand.name}
            </span>
            <span>Oferty przykładowe · rezerwacje bez wpłat w VANLY</span>
          </div>
        </div>
      </footer>
    </Context.Provider>
  );
}
