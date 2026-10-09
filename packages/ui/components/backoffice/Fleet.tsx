'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Row, useApp, Field, CheckField, Notice, Badge, asset, money, types } from '../shared';
import { hasCoordinates, LocalityInput, pickupAddress } from '../PickupLocation';
import { CreditsWallet, PublicationInfo } from './Credits';
import { createRequestId } from '../../lib/request-id';

export function Fleet({ d, reload }: { d: Row; reload: () => void }) {
  return (
    <>
      <div className="section-head">
        <h2>Twoje pojazdy</h2>
        <Link className="btn primary" href="/company/vehicle/new">
          <Plus size={17} />
          Dodaj pojazd
        </Link>
      </div>
      <CreditsWallet billing={d.billing} reload={reload} />
      <div className="vehicle-grid">
        {d.vehicles.map((v: Row) => (
          <article className="vehicle-card" key={v.id}>
            <div className="vehicle-picture">
              <img src={asset(v.asset)} alt="" />
            </div>
            <div className="vehicle-card-body">
              <div className="spread">
                <h3>{v.name}</h3>
                <Badge status={v.status} />
              </div>
              <p className="small muted">
                {pickupAddress(v)} · {v.sleeps} miejsc do spania
              </p>
              <PublicationInfo
                publication={d.billing?.publications.find((p: Row) => p.vehicle_id === v.id)}
              />
              <div className="spread" style={{ marginTop: 20 }}>
                <strong>{money(v.daily)} / doba</strong>
                <Link className="btn secondary compact" href={'/company/vehicle/' + v.id}>
                  Edytuj ofertę
                </Link>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
export function VehicleForm({
  vehicle: v,
  company,
  billing,
  reload,
}: {
  vehicle?: Row;
  company: Row;
  billing?: Row;
  reload: () => void;
}) {
  const { api, act, navigate } = useApp();
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const savedId = useRef(v?.id);
  const createKey = useRef<string | null>(null);
  const publication = billing?.publications?.find((p: Row) => p.vehicle_id === v?.id);
  const needsCredit = v
    ? !publication?.exempt &&
      (!publication?.valid_until || new Date(publication.valid_until) <= new Date())
    : billing?.nextPublicationCredits !== 0;
  const canPublish = !needsCredit || (billing?.wallet?.balance ?? 0) > 0;
  const submitting = useRef(false);
  const defaults: Row = v || {
    name: '',
    type: 'campervan',
    city: '',
    lat: null,
    lng: null,
    street: '',
    house_number: '',
    seats: 4,
    sleeps: 4,
    daily: 42900,
    prep: company.settings.prep,
    deposit: 400000,
    min_days: 2,
    km: 250,
    auto: false,
    pets: false,
    instant: false,
    description: '',
    tagline: '',
    features: [],
    asset: 'campervan.webp',
    status: 'draft',
  };
  const [pickup, setPickup] = useState({
    city: defaults.city || '',
    lat: hasCoordinates(defaults) ? defaults.lat : null,
    lng: hasCoordinates(defaults) ? defaults.lng : null,
  });
  return (
    <form
      className="panel stack"
      key={v?.id || 'new'}
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitting.current) return;
        submitting.current = true;
        const f = new FormData(e.currentTarget),
          d: Row = {};
        ['name', 'type', 'description', 'tagline', 'status'].forEach((k) => (d[k] = f.get(k)));
        d.city = pickup.city.trim();
        d.lat = pickup.lat;
        d.lng = pickup.lng;
        ['street', 'house_number'].forEach((k) => (d[k] = String(f.get(k) || '').trim()));
        ['seats', 'sleeps', 'min_days'].forEach((k) => (d[k] = Number(f.get(k))));
        ['daily', 'prep', 'deposit'].forEach((k) => (d[k] = Math.round(Number(f.get(k)) * 100)));
        ['auto', 'pets'].forEach((k) => (d[k] = f.get(k) === 'on'));
        d.instant = false;
        d.km = f.get('km') ? Number(f.get('km')) : null;
        d.features = String(f.get('features'))
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        if (f.get('asset')) d.asset = f.get('asset');
        setBusy(true);
        try {
          await act(async () => {
            const saved = await api(
              '/owner/vehicles' + (savedId.current ? '/' + savedId.current : ''),
              savedId.current ? 'PATCH' : 'POST',
              d,
              savedId.current ? undefined : (createKey.current ??= createRequestId()),
            );
            savedId.current = saved.id;
            if (photo) {
              const body = new FormData();
              body.set('file', photo);
              try {
                await api('/owner/vehicles/' + saved.id + '/photo', 'POST', body);
              } catch (error: any) {
                throw new Error(
                  'Dane pojazdu zapisane. Nie udało się zapisać zdjęcia: ' +
                    error.message +
                    ' Ponowny zapis dokończy tę ofertę.',
                );
              }
            }
            reload();
            navigate('/company/fleet');
          }, 'Oferta zapisana.');
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}
    >
      <div className="spread">
        <h2>{v ? 'Edytuj ofertę' : 'Dodaj pojazd do floty'}</h2>
        <Link className="text-link" href="/company/fleet">
          Wróć do floty
        </Link>
      </div>
      <Notice>
        Pierwszy dodany pojazd jest bezpłatny. Każdy kolejny kamper lub przyczepa: 1 Credit za
        miesiąc (200 zł). Publikacja włącza automatyczne odnowienia z portfela. Ręczne ukrycie
        oferty zatrzymuje odnowienia i zachowuje opłacony okres.
      </Notice>
      <PublicationInfo publication={publication} />
      {!canPublish && (
        <Notice>
          Brak Creditsów na nowy miesiąc. Zasil portfel w widoku floty lub zapisz ofertę jako szkic.
        </Notice>
      )}
      <div className="form-grid">
        <Field label="Nazwa pojazdu">
          <input
            className="input"
            name="name"
            defaultValue={defaults.name}
            required
            minLength={3}
            maxLength={100}
          />
        </Field>
        <Field label="Typ pojazdu">
          <select className="input" name="type" defaultValue={defaults.type}>
            {types.slice(1).map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Krótki opis" full>
          <input className="input" name="tagline" defaultValue={defaults.tagline} maxLength={150} />
        </Field>
        <Field label="Opis pojazdu" full>
          <textarea
            className="input tall"
            name="description"
            defaultValue={defaults.description}
            required
            minLength={10}
            maxLength={5000}
          />
        </Field>
        <section className="pickup-section" aria-labelledby="pickup-heading">
          <h3 id="pickup-heading">Miejsce odbioru</h3>
          <p className="small muted" id="pickup-help">
            Podaj miejscowość lub gminę, w której można odebrać ten pojazd. Wybierz podpowiedź lub
            wpisz własną nazwę. Ulicę i numer możesz dodać opcjonalnie.
          </p>
          <div className="form-grid">
            <div className="form-field full">
              <label htmlFor="vehicle-pickup-city">Miejscowość lub gmina</label>
              <LocalityInput
                id="vehicle-pickup-city"
                name="city"
                value={pickup.city}
                required
                describedBy="pickup-help"
                onChange={(city, locality) =>
                  setPickup({
                    city,
                    lat: locality && hasCoordinates(locality) ? locality.lat : null,
                    lng: locality && hasCoordinates(locality) ? locality.lng : null,
                  })
                }
              />
            </div>
            <Field label="Ulica (opcjonalnie)">
              <input
                className="input"
                name="street"
                defaultValue={defaults.street || ''}
                maxLength={160}
                placeholder="Np. Słoneczna"
                autoComplete="address-line1"
              />
            </Field>
            <Field label="Numer domu / lokalu (opcjonalnie)">
              <input
                className="input"
                name="house_number"
                defaultValue={defaults.house_number || ''}
                maxLength={30}
                placeholder="Np. 12A/3"
              />
            </Field>
          </div>
        </section>
        {[
          ['seats', 'Miejsca do jazdy', 1],
          ['sleeps', 'Miejsca do spania', 1],
          ['daily', 'Cena bazowa za dobę (zł)', 100],
          ['deposit', 'Kaucja (zł)', 100],
          ['min_days', 'Minimum dób', 1],
          ['km', 'Kilometry za dobę (puste = bez limitu)', 1],
        ].map(([k, l, div]: any) => (
          <Field label={l} key={k}>
            <input
              className="input"
              type="number"
              name={k}
              defaultValue={defaults[k] === null ? '' : defaults[k] / div}
              step={div === 100 ? '0.01' : '1'}
              min={k === 'seats' ? '0' : k === 'deposit' ? '0' : '1'}
              max={['seats', 'sleeps'].includes(k) ? 12 : undefined}
              required={k !== 'km'}
            />
          </Field>
        ))}
        <input type="hidden" name="prep" value={defaults.prep / 100} />
        <Field label="Wyposażenie w cenie — jeden element w wierszu" full>
          <textarea
            className="input tall"
            name="features"
            defaultValue={defaults.features.join('\n')}
            maxLength={3000}
          />
        </Field>
        <Field label="Ilustracja">
          <select
            className="input"
            name="asset"
            defaultValue={defaults.asset.startsWith('/api/') ? '' : defaults.asset}
          >
            {defaults.asset.startsWith('/api/') && (
              <option value="">Zachowaj aktualne zdjęcie</option>
            )}
            {types.slice(1).map(([id, n, a]) => (
              <option key={id} value={a}>
                {n}
              </option>
            ))}
            <option value="minivan.webp">Minivan Weekend</option>
          </select>
        </Field>
        <Field label="Własne zdjęcie (JPEG, PNG, WebP, do 5 MB)">
          <input
            className="input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setPhoto(e.target.files?.[0] || null)}
          />
        </Field>
        <Field label="Widoczność oferty">
          <select className="input" name="status" defaultValue={defaults.status}>
            <option value="draft">Szkic</option>
            <option value="published" disabled={!company.verified || !canPublish}>
              Opublikowana
            </option>
            <option value="hidden">Ukryta</option>
          </select>
        </Field>
        <div>
          <CheckField label="Automatyczna skrzynia" name="auto" defaultChecked={defaults.auto} />
          <CheckField label="Można zabrać psa" name="pets" defaultChecked={defaults.pets} />
          <p className="small muted">Każdą rezerwację potwierdza wypożyczalnia.</p>
        </div>
      </div>
      {!company.verified && (
        <Notice>
          Możesz przygotować szkice. Publikacja będzie możliwa po weryfikacji firmy przez operatora.
        </Notice>
      )}
      <button className="btn primary" disabled={busy}>
        {busy ? 'Zapisujemy…' : 'Zapisz pojazd'}
      </button>
    </form>
  );
}
