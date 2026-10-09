'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { isCamperfolks, isHeyvans } from '../../lib/brand';
import { ArrowRight, SlidersHorizontal, Map, List } from 'lucide-react';
import { Row, useData, DataState, Field, CheckField, Empty, Heading, Card, types } from '../shared';
import { SearchForm } from './search-form';
import { MapView } from './map';

export function Search() {
  const params = useSearchParams();
  const initial = Object.fromEntries(params.entries());
  const [filters, setFilters] = useState<Row>({
    type: initial.type || 'all',
    sort: 'recommended',
    auto: false,
    pets: false,
    budget: '',
    radius: '50',
  });
  const [features, setFeatures] = useState<string[]>([]);
  const [map, setMap] = useState(false),
    [compare, setCompare] = useState<string[]>([]);
  useEffect(
    () => setFilters((f) => ({ ...f, type: params.get('type') || 'all' })),
    [params.get('type')],
  );
  const p = new URLSearchParams();
  for (const key of ['location', 'start', 'end', 'guests'])
    if (initial[key]) p.set(key, initial[key]);
  Object.entries(filters).forEach(([k, v]) => {
    if (v) p.set(k, String(k === 'budget' ? Number(v) * 100 : v));
  });
  features.forEach((feature) => p.append('feature', feature));
  const { data, error } = useData('/catalog?' + p);
  const set = (k: string, v: any) => setFilters((f) => ({ ...f, [k]: v }));
  const dates = new URLSearchParams();
  ['start', 'end', 'guests'].forEach((k) => {
    if (initial[k]) dates.set(k, initial[k]);
  });
  const query = dates.size ? '?' + dates : '';
  return (
    <div className="container">
      <Heading
        eyebrow={
          isHeyvans
            ? 'Kampery i przyczepy do wynajęcia'
            : isCamperfolks
              ? 'Najpierw wybierz pojazd'
              : 'Dobry kierunek zaczyna się od wyboru'
        }
        title={
          isHeyvans
            ? 'Który jedzie z Tobą?'
            : isCamperfolks
              ? 'Kamper czy przyczepa?'
              : 'Znajdź swój kawałek wolności.'
        }
      />
      <SearchForm key={params.toString()} initial={initial} compact />
      <div className="results-layout">
        <aside className="filter-panel">
          <h3 className="inline">
            <SlidersHorizontal size={19} /> Dopasuj do siebie
          </h3>
          <div className="filter-section">
            <Field label="Rodzaj pojazdu">
              <select
                className="input"
                value={filters.type}
                onChange={(e) => set('type', e.target.value)}
              >
                {types.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="filter-section">
            <h3>Wygoda w drodze</h3>
            {[
              ['auto', 'Automatyczna skrzynia'],
              ['pets', 'Możesz zabrać psa'],
            ].map(([k, t]) => (
              <CheckField
                key={k}
                label={t}
                checked={filters[k]}
                onChange={(e) => set(k, e.target.checked)}
              />
            ))}
          </div>
          <div className="filter-section" role="group" aria-labelledby="equipment-filter-label">
            <h3 id="equipment-filter-label">Wyposażenie w cenie</h3>
            {[
              ['shower', 'Prysznic'],
              ['kitchen', 'Kuchnia'],
              ['heat', 'Ogrzewanie'],
            ].map(([feature, label]) => (
              <CheckField
                key={feature}
                label={label}
                checked={features.includes(feature)}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setFeatures((selected) =>
                    checked
                      ? [...selected, feature]
                      : selected.filter((value) => value !== feature),
                  );
                }}
              />
            ))}
          </div>
          <div className="filter-section">
            <Field label={initial.start ? 'Budżet za wyjazd (zł)' : 'Doba z przygotowaniem (zł)'}>
              <input
                className="input"
                type="number"
                min="0"
                placeholder="Bez limitu"
                value={filters.budget}
                onChange={(e) => set('budget', e.target.value)}
              />
            </Field>
            <Field label="Promień od miasta (km)">
              <select
                className="input"
                value={filters.radius}
                onChange={(e) => set('radius', e.target.value)}
              >
                {[25, 50, 100, 200, 500].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
          </div>
        </aside>
        <div>
          <div className="results-head">
            <h2>
              {data?.length ?? '…'} {data?.length === 1 ? 'pojazd' : 'pojazdów'} na Twój wyjazd
            </h2>
            <div className="inline">
              <select
                aria-label="Sortowanie"
                className="sort-select"
                value={filters.sort}
                onChange={(e) => set('sort', e.target.value)}
              >
                <option value="recommended">Polecane</option>
                <option value="price">Cena rosnąco</option>
                <option value="price-desc">Cena malejąco</option>
              </select>
              <div className="segmented">
                <button onClick={() => setMap(false)} className={!map ? 'active' : ''}>
                  <List size={16} />
                  Lista
                </button>
                <button onClick={() => setMap(true)} className={map ? 'active' : ''}>
                  <Map size={16} />
                  Mapa
                </button>
              </div>
            </div>
          </div>
          <DataState data={data} error={error}>
            {data?.length === 0 ? (
              <Empty
                title={
                  isHeyvans || isCamperfolks
                    ? 'Brak pojazdów dla tego wyboru.'
                    : 'Tu jeszcze jest przestrzeń na inny plan.'
                }
                text="Zmień termin, miejsce odbioru lub filtry i sprawdź ponownie."
              />
            ) : (
              <>
                <div className={map ? 'live-results-map' : ''}>
                  <div className="vehicle-grid">
                    {data?.map((v: Row) => (
                      <div key={v.id}>
                        <Card
                          v={{ ...v, total_minor: initial.start ? v.total_minor : null }}
                          query={query}
                        />
                        <label className="compare-check">
                          <input
                            type="checkbox"
                            checked={compare.includes(v.id)}
                            disabled={compare.length >= 3 && !compare.includes(v.id)}
                            onChange={(e) =>
                              setCompare(
                                e.target.checked
                                  ? [...compare, v.id]
                                  : compare.filter((x) => x !== v.id),
                              )
                            }
                          />
                          Porównaj pojazd
                        </label>
                      </div>
                    ))}
                  </div>
                  {map && <MapView items={data || []} />}
                </div>
                {compare.length > 0 && (
                  <div className="compare-dock">
                    <span>Wybrano {compare.length} / 3 pojazdy</span>
                    <Link
                      className="btn primary compact"
                      href={'/porownaj?ids=' + compare.join(',')}
                    >
                      Porównaj <ArrowRight size={16} />
                    </Link>
                  </div>
                )}
              </>
            )}
          </DataState>
        </div>
      </div>
    </div>
  );
}
