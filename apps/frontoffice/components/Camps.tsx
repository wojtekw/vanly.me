'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MapPin, Search, ExternalLink, TentTree, X, Compass } from 'lucide-react';
import { Heading, Notice, useApp, useData } from './shared';
import { loadGoogleMaps } from '../lib/google-maps';
import { brand, isCamperfolks, isHeyvans } from '../lib/brand';

type MapBounds = { south: number; west: number; north: number; east: number };
type GoogleElement = HTMLElement & {
  places?: any[];
  place?: any;
  textQuery?: string;
  locationRestriction?: MapBounds;
};
const polandBounds: MapBounds = { south: 49, west: 14.1, north: 54.9, east: 24.2 };
const regions = ['Polska', 'Mazury', 'Kaszuby', 'Półwysep Helski', 'Bieszczady', 'Chorwacja'];
const googleUrl = (query: string) =>
  'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);

export function Camps() {
  const { api, ready } = useApp();
  const { data: config, error: configError } = useData('/maps/status');
  const [region, setRegion] = useState('Polska');
  const [resultsArea, setResultsArea] = useState('Polska');
  const [kind, setKind] = useState('campground');
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const mapHost = useRef<HTMLDivElement>(null);
  const resultsHost = useRef<HTMLDivElement>(null);
  const detailsHost = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const flight = useRef(false);
  const autoStarted = useRef(false);
  const detailFlight = useRef(false);
  const generation = useRef(0);
  const detailGeneration = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const detailTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sdk = useRef<any>(null);
  const map = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const query = `${kind === 'rv_park' ? 'Miejsca dla kamperów' : 'Kempingi'} ${region.trim()}`;
  const available = Boolean(config?.enabled && config?.available);

  const clearMarkers = () => {
    markers.current.forEach((marker) => {
      marker.map = null;
    });
    markers.current = [];
  };
  const closeDetails = () => {
    detailGeneration.current++;
    clearTimeout(detailTimer.current);
    detailsHost.current?.replaceChildren();
    setSelected(null);
    setDetailBusy(false);
    detailFlight.current = false;
  };
  useEffect(() => {
    alive.current = true;
    const authError = () => {
      clearTimeout(timer.current);
      clearTimeout(detailTimer.current);
      generation.current++;
      setError(
        'Google nie udostępniło mapy. Sprawdź połączenie lub skorzystaj z odnośnika do Google Maps.',
      );
      setBusy(false);
      setDetailBusy(false);
      flight.current = false;
      detailFlight.current = false;
    };
    window.addEventListener('vanly-maps-error', authError);
    return () => {
      alive.current = false;
      generation.current++;
      clearTimeout(timer.current);
      clearTimeout(detailTimer.current);
      clearMarkers();
      window.removeEventListener('vanly-maps-error', authError);
      if (sdk.current && map.current) sdk.current.event.clearInstanceListeners(map.current);
    };
  }, []);

  useEffect(() => {
    if (!ready || !available || autoStarted.current) return;
    // Wait for the session/CSRF token. Defer one task so StrictMode's effect
    // replay can cancel the first start before it consumes an allowance.
    const start = setTimeout(() => {
      if (!autoStarted.current) void search('Polska', 'campground');
    }, 0);
    return () => clearTimeout(start);
  }, [ready, available]);

  async function showDetails(place: any, searchGeneration: number) {
    if (!alive.current || generation.current !== searchGeneration || detailFlight.current) return;
    detailFlight.current = true;
    const detailVersion = ++detailGeneration.current;
    setDetailBusy(true);
    setError('');
    try {
      await api('/maps/permit', 'POST', { operation: 'details' });
      if (
        !alive.current ||
        generation.current !== searchGeneration ||
        detailGeneration.current !== detailVersion
      )
        return;
      const detail = document.createElement('gmp-place-details') as GoogleElement;
      const request = document.createElement('gmp-place-details-place-request') as GoogleElement;
      request.place = place.id;
      detail.append(request, document.createElement('gmp-place-all-content'));
      const done = () => {
        if (
          !alive.current ||
          generation.current !== searchGeneration ||
          detailGeneration.current !== detailVersion
        )
          return;
        clearTimeout(detailTimer.current);
        detailFlight.current = false;
        setDetailBusy(false);
      };
      detail.addEventListener('gmp-load', done, { once: true });
      detail.addEventListener(
        'gmp-error',
        () => {
          if (
            !alive.current ||
            generation.current !== searchGeneration ||
            detailGeneration.current !== detailVersion
          )
            return;
          done();
          setError(
            'Nie udało się pobrać szczegółów tego miejsca. Spróbuj otworzyć je w Google Maps.',
          );
        },
        { once: true },
      );
      detailsHost.current?.replaceChildren(detail);
      setSelected(place.id);
      detailTimer.current = setTimeout(() => {
        if (
          !alive.current ||
          generation.current !== searchGeneration ||
          detailGeneration.current !== detailVersion
        )
          return;
        done();
        setError('Pobieranie szczegółów trwa zbyt długo. Spróbuj ponownie.');
      }, 20000);
      if (place.location) {
        map.current.panTo(place.location);
        map.current.setZoom(12);
      }
      detailsHost.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e: any) {
      if (alive.current && detailGeneration.current === detailVersion) {
        setError(e.message);
        setDetailBusy(false);
        detailFlight.current = false;
      }
    }
  }

  async function search(regionName = region, placeKind = kind, area?: MapBounds) {
    if (flight.current || !ready || !available || (!area && !regionName.trim())) return;
    autoStarted.current = true;
    flight.current = true;
    const current = ++generation.current;
    const wholePoland = !area && regionName.trim().toLocaleLowerCase('pl') === 'polska';
    const searchQuery = `${placeKind === 'rv_park' ? 'Miejsca dla kamperów' : 'Kempingi'}${area ? '' : ' ' + regionName.trim()}`;
    setResultsArea(area ? 'Widoczny obszar' : regionName.trim());
    setBusy(true);
    setError('');
    setCount(null);
    closeDetails();
    clearMarkers();
    resultsHost.current?.replaceChildren();
    try {
      if (!map.current) {
        const permission = await api('/maps/permit', 'POST', { operation: 'map' });
        if (!alive.current || generation.current !== current) return;
        const googleMaps = await loadGoogleMaps(permission.browserKey);
        await Promise.all([
          googleMaps.importLibrary('maps'),
          googleMaps.importLibrary('places'),
          googleMaps.importLibrary('marker'),
        ]);
        if (!alive.current || generation.current !== current) return;
        sdk.current = googleMaps;
        setStarted(true);
        map.current = new googleMaps.Map(mapHost.current!, {
          center: { lat: 52, lng: 19.2 },
          zoom: 5,
          mapId: permission.mapId,
          mapTypeControl: false,
          streetViewControl: false,
          clickableIcons: false,
          gestureHandling: 'cooperative',
          fullscreenControl: true,
        });
      }
      if (wholePoland) map.current.fitBounds(polandBounds, 24);
      await api('/maps/permit', 'POST', { operation: 'search' });
      if (!alive.current || generation.current !== current) return;
      const list = document.createElement('gmp-place-search') as GoogleElement;
      list.setAttribute('selectable', '');
      const request = document.createElement('gmp-place-text-search-request') as GoogleElement;
      request.setAttribute('max-result-count', '20');
      request.setAttribute('included-type', placeKind);
      request.setAttribute('use-strict-type-filtering', '');
      // One initial query, then explicit searches. Panning or typing never
      // triggers a query. Configure while detached to avoid intermediate requests.
      if (area || wholePoland) request.locationRestriction = area || polandBounds;
      request.textQuery = searchQuery;
      list.append(document.createElement('gmp-place-all-content'), request);
      list.addEventListener('gmp-select', (event: Event) => {
        const place = (event as any).place;
        if (place?.id) void showDetails(place, current);
      });
      const finish = () => {
        if (!alive.current || generation.current !== current) return false;
        clearTimeout(timer.current);
        flight.current = false;
        setBusy(false);
        return true;
      };
      list.addEventListener('gmp-load', () => {
        if (!finish()) return;
        const places = list.places || [];
        setCount(places.length);
        clearMarkers();
        const bounds = new sdk.current.LatLngBounds();
        for (const [index, place] of places.entries()) {
          if (!place.location) continue;
          const pin = new sdk.current.marker.PinElement({
            background: '#143b39',
            borderColor: '#faf8f3',
            glyphColor: '#ffffff',
            glyphText: String(index + 1),
          });
          const marker = new sdk.current.marker.AdvancedMarkerElement({
            map: map.current,
            position: place.location,
            title: `Kemping — wynik ${index + 1}`,
            gmpClickable: true,
          });
          marker.append(pin);
          marker.addEventListener('gmp-click', () => void showDetails(place, current));
          markers.current.push(marker);
          bounds.extend(place.location);
        }
        // Keep the country overview and a manually selected viewport stable.
        if (wholePoland || area) return;
        if (markers.current.length === 1) {
          map.current.setCenter(places.find((p: any) => p.location).location);
          map.current.setZoom(12);
        } else if (markers.current.length > 1) map.current.fitBounds(bounds, 50);
      });
      list.addEventListener('gmp-error', () => {
        if (finish())
          setError(
            'Google nie zwróciło wyników. Spróbuj ponownie lub otwórz wyszukiwanie w Google Maps.',
          );
      });
      timer.current = setTimeout(() => {
        if (finish())
          setError('Wyszukiwanie trwa zbyt długo. Sprawdź połączenie i spróbuj ponownie.');
      }, 20000);
      resultsHost.current?.replaceChildren(list);
    } catch (e: any) {
      if (alive.current && generation.current === current) {
        setError(e.message);
        setBusy(false);
        flight.current = false;
      }
    }
  }

  function searchVisibleArea() {
    const bounds = map.current?.getBounds()?.toJSON();
    if (!bounds) return;
    void search(region, kind, bounds);
  }

  return (
    <div className="container section camps-page">
      <div className="camps-heading">
        <Heading
          eyebrow="Dobry przystanek też jest częścią drogi"
          title={
            isHeyvans
              ? 'Gdzie robisz bazę?'
              : isCamperfolks
                ? 'Znajdź miejsce na nocleg.'
                : 'Zostań tam, gdzie jest dobrze.'
          }
        />
        <p>
          {isHeyvans
            ? 'Wyszukaj kemping w wybranym regionie. Sprawdź dojazd, zasady i zaplanuj nocleg.'
            : isCamperfolks
              ? 'Kamper, przyczepa czy namiot? Zobacz kempingi i pola namiotowe na mapie. Wyszukaj region albo miejscowość i wybierz kolejny przystanek.'
              : 'Rozejrzyj się po Polsce. Przybliż mapę, znajdź kemping nad wodą, w górach albo po drodze i wybierz swój następny przystanek.'}
        </p>
      </div>
      <form
        className="camps-search panel"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label className="form-field">
          <span>{isHeyvans || isCamperfolks ? 'Gdzie szukasz miejsca?' : 'Dokąd jedziemy?'}</span>
          <div className="camps-input">
            <MapPin size={20} />
            <input
              aria-label="Region lub miejscowość"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="Np. Mazury, Hel, Istria"
              maxLength={100}
              required
            />
          </div>
        </label>
        <label className="form-field">
          <span>Jakiego miejsca szukasz?</span>
          <select
            aria-label="Rodzaj miejsca"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="campground">Kempingi i pola namiotowe</option>
            <option value="rv_park">Miejsca dla kamperów</option>
          </select>
        </label>
        <button
          type="submit"
          className="btn primary"
          disabled={!ready || !available || busy || !region.trim()}
        >
          <Search size={18} />
          {busy ? 'Szukamy miejsc…' : 'Szukaj w regionie'}
        </button>
      </form>
      <div className="camps-regions">
        <span>Przejdź do:</span>
        {regions.map((r) => (
          <button
            type="button"
            key={r}
            className={resultsArea === r ? 'active' : ''}
            aria-pressed={resultsArea === r}
            disabled={!ready || !available || busy}
            onClick={() => {
              setRegion(r);
              void search(r);
            }}
          >
            {r === 'Polska' ? 'Cała Polska' : r}
          </button>
        ))}
      </div>
      <p className="small muted camps-privacy">
        Mapa Google wczytuje się przy otwarciu tej strony. Google otrzymuje wyszukiwany obszar i
        dane połączenia. <Link href="/mapy-i-prywatnosc">Zasady map i prywatność</Link>.
      </p>
      {configError && (
        <Notice error>
          Nie udało się sprawdzić dostępności mapy. Odśwież stronę lub otwórz Google Maps poniżej.
        </Notice>
      )}
      {error && (
        <div role="alert">
          <Notice error>{error}</Notice>
        </div>
      )}
      {started && (
        <div className="camps-map-tools">
          <p className="small muted">Przybliż lub przesuń mapę, żeby sprawdzić kolejne miejsca.</p>
          <button
            type="button"
            className="btn secondary"
            disabled={busy || !available}
            onClick={searchVisibleArea}
          >
            <Search size={18} /> Szukaj w tym obszarze
          </button>
        </div>
      )}
      <div className={'camps-explorer ' + (started ? 'is-started' : '')}>
        <div className="camps-map-shell">
          <div className="camps-google-map" ref={mapHost} aria-label="Mapa kempingów Google" />
          {!started && (
            <div className="camps-map-intro">
              <img src="/assets/campsite.webp" alt="Ilustracja odpoczynku na kempingu" />
              <div>
                <span className="camps-round-icon">
                  <TentTree size={27} />
                </span>
                <h2>
                  {!config
                    ? 'Sprawdzamy mapę…'
                    : config.enabled
                      ? config.available
                        ? error
                          ? 'Nie udało się wczytać mapy.'
                          : 'Ładujemy mapę Polski…'
                        : 'Mapa zrobiła przerwę.'
                      : 'Mapa jest niedostępna.'}
                </h2>
                <p>
                  {!config
                    ? 'Za chwilę będzie można wybrać kierunek.'
                    : config.enabled
                      ? config.available
                        ? error
                          ? 'Spróbuj ponownie przyciskiem „Szukaj w regionie” lub otwórz Google Maps.'
                          : 'Kempingi pojawią się na mapie i na liście obok. Możesz potem zawęzić obszar wyszukiwania.'
                        : 'Osiągnęliśmy limit wyszukiwania. Nadal możesz sprawdzić miejsca bezpośrednio w Google Maps.'
                      : 'Sprawdź kempingi w wybranym regionie bezpośrednio w Google Maps.'}
                </p>
                <a
                  href={googleUrl(query)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn secondary"
                >
                  Otwórz Google Maps <ExternalLink size={16} />
                </a>
              </div>
            </div>
          )}
        </div>
        <aside className="camps-results" aria-label="Wyniki wyszukiwania kempingów">
          <div className="camps-results-header">
            <Compass size={21} />
            <h2>{resultsArea === 'Polska' ? 'Kempingi w Polsce' : resultsArea}</h2>
          </div>
          <p aria-live="polite" className="small muted camps-result-count">
            {busy
              ? 'Pobieramy wyniki z Google…'
              : count === null
                ? config && !available
                  ? 'Otwórz Google Maps, aby sprawdzić miejsca w wybranym regionie.'
                  : 'Za chwilę pojawią się miejsca z Google Maps.'
                : count === 0
                  ? 'Brak wyników. Spróbuj pobliskiej miejscowości lub innego rodzaju miejsca.'
                  : `Pokazujemy ${count} miejsc z Google. Kliknij kartę lub punkt na mapie.`}
          </p>
          {count !== null && count > 0 && (
            <p className="small muted">
              To wybrane wyniki dla tego obszaru. Przybliż mapę i wyszukaj, żeby zobaczyć kolejne
              kempingi.
            </p>
          )}
          <div className="camps-google-results" ref={resultsHost} />
          {!started && (
            <div className="camps-empty">
              <MapPin size={32} />
              <p>
                Własne tempo.
                <br />
                Dobry adres na noc.
              </p>
              <span>Zdjęcia, oceny i kontakt do miejsc udostępnianych przez Google.</span>
            </div>
          )}
        </aside>
      </div>
      <section
        className="camps-details panel"
        hidden={!selected && !detailBusy}
        aria-label="Szczegóły kempingu"
      >
        <div className="spread">
          <h2>Sprawdź swój przystanek</h2>
          <button
            className="icon-btn"
            aria-label="Zamknij szczegóły kempingu"
            onClick={closeDetails}
          >
            <X size={21} />
          </button>
        </div>
        {detailBusy && (
          <p role="status" className="small muted">
            Pobieramy szczegóły miejsca…
          </p>
        )}
        <div ref={detailsHost} />
        {selected && (
          <a
            className="text-link"
            href={
              'https://www.google.com/maps/search/?api=1&query=kemping&query_place_id=' +
              encodeURIComponent(selected)
            }
            target="_blank"
            rel="noopener noreferrer"
          >
            Otwórz miejsce w Google Maps <ExternalLink size={16} />
          </a>
        )}
      </section>
      <div className="camps-footnote">
        <p>
          Zdjęcia, oceny i informacje o miejscach pochodzą z Google. Lista pokazuje wyniki
          wyszukiwania, a nie pełny katalog wszystkich kempingów. Dostępność parceli i aktualną cenę
          potwierdź bezpośrednio w obiekcie.
        </p>
        <a className="text-link" href={googleUrl(query)} target="_blank" rel="noopener noreferrer">
          Szukaj w Google Maps <ExternalLink size={16} />
        </a>
      </div>
    </div>
  );
}

export function MapsPrivacy() {
  return (
    <div className="container section reading">
      <p className="eyebrow">Mapy w {brand.name}</p>
      <h1>Wiesz, dokąd trafiają Twoje dane.</h1>
      <section>
        <h2>Kiedy łączymy się z Google</h2>
        <p>
          Mapę Polski i pierwszą listę kempingów wczytujemy automatycznie po otwarciu zakładki
          „Kempingi”. Google otrzymuje zapytanie o Polskę, adres IP oraz dane przeglądarki potrzebne
          do działania usługi. Kolejne wyszukiwania przekazują wybrany region lub granice obszaru
          widocznego na mapie. Możesz korzystać z pozostałej części {brand.name} bez wczytywania tej
          mapy.
        </p>
        <p>
          Odnośniki „Otwórz Google Maps” i „Szukaj w Google Maps” prowadzą do zewnętrznego serwisu
          Google.
        </p>
      </section>
      <section>
        <h2>Informacje o miejscach</h2>
        <p>
          Google udostępnia nazwy, zdjęcia, oceny i pozostałe informacje we własnych komponentach.
          {isHeyvans ? brand.name : 'Vanly'} nie kopiuje tych treści do swojej bazy ani nie
          przechowuje historii zapytań. Zapisujemy jedynie zbiorczą liczbę operacji mapy i
          wyszukiwarki, aby kontrolować wykorzystanie usługi.
        </p>
        <p>
          Wyniki Google nie potwierdzają wolnych parceli, ceny konkretnego pobytu ani możliwości
          rezerwacji przez {brand.name}. Uzgodnij pobyt bezpośrednio z kempingiem.
        </p>
      </section>
      <section>
        <h2>Zasady Google</h2>
        <p>
          Korzystanie z funkcji Google Maps podlega{' '}
          <a
            className="text-link"
            href="https://maps.google.com/help/terms_maps/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Warunkom korzystania z Google Maps
          </a>{' '}
          oraz{' '}
          <a
            className="text-link"
            href="https://policies.google.com/privacy?hl=pl"
            target="_blank"
            rel="noopener noreferrer"
          >
            Polityce prywatności Google
          </a>
          .
        </p>
      </section>
      <Link className="btn secondary" href="/kempingi">
        Wróć do kempingów
      </Link>
    </div>
  );
}
