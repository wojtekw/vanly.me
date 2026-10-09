'use client';
import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { pickupAddress } from '../PickupLocation';
import { Row, useApp, useData, DataState, Empty, Heading, Card, asset, money } from '../shared';

export function Favorites() {
  const { user, favorites } = useApp();
  return (
    <div className="container section">
      <Heading eyebrow="Dobre pomysły zostają" title="Zapisane na później." />
      {!user ? (
        <Empty title="Zachowaj swoje typy." text="Zaloguj się, by wracać do wybranych pojazdów.">
          <Link className="btn primary" href="/logowanie">
            Zaloguj się
          </Link>
        </Empty>
      ) : favorites.length ? (
        <div className="vehicle-grid three">
          {favorites.map((v: Row) => (
            <Card key={v.id} v={v} />
          ))}
        </div>
      ) : (
        <Empty
          title="Tu zmieszczą się Twoje plany."
          text="Kliknij serce przy pojeździe, aby zapisać go na później."
        >
          <Link className="btn primary" href="/pojazdy">
            Przeglądaj pojazdy
          </Link>
        </Empty>
      )}
    </div>
  );
}

export function Compare() {
  const params = useSearchParams(),
    ids = (params.get('ids') || '').split(',').slice(0, 3);
  const { data, error } = useData('/catalog');
  const rows = data?.filter((v: Row) => ids.includes(v.id)) || [];
  return (
    <div className="container section">
      <Heading title="Wybór robi się prostszy." />
      <DataState data={data} error={error}>
        {rows.length ? (
          <div className="table-scroll">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Co jest ważne?</th>
                  {rows.map((v: Row) => (
                    <th key={v.id}>
                      <img src={asset(v.asset)} alt="" />
                      <Link href={'/pojazd/' + v.id}>{v.name}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Miejsce odbioru', 'city'],
                  ['Cena za dobę', 'daily'],
                  ['Kaucja osobno', 'deposit'],
                  ['Miejsca do jazdy', 'seats'],
                  ['Miejsca do spania', 'sleeps'],
                  ['Pies na pokładzie', 'pets'],
                  ['Automat', 'auto'],
                  ['Minimum dób', 'min_days'],
                ].map(([label, key]) => (
                  <tr key={key}>
                    <th>{label}</th>
                    {rows.map((v: Row) => (
                      <td key={v.id}>
                        {key === 'city'
                          ? pickupAddress(v)
                          : ['daily', 'deposit'].includes(key)
                            ? money(v[key])
                            : typeof v[key] === 'boolean'
                              ? v[key]
                                ? 'Tak'
                                : 'Nie'
                              : v[key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Wybierz pojazdy do porównania."
            text="Na liście możesz zaznaczyć do trzech ofert."
          />
        )}
      </DataState>
    </div>
  );
}
