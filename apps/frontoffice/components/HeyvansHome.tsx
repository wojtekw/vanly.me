'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Card, DataState, Row, asset, types } from './shared';

const categories = [
  'Kompaktowo, z miejscem do spania.',
  'Więcej miejsca na wyjazd.',
  'Sprawdź układ dla swojej ekipy.',
  'Sprawdź pojazdy z napędem 4×4.',
  'Baza, którą zabierasz ze sobą.',
];
const guides = [
  [
    'first',
    'Na dobry początek',
    'Pierwszy wyjazd kamperem',
    'Wybór pojazdu i przygotowanie do pierwszej nocy.',
  ],
  [
    'kamper-campervan-przyczepa',
    'Twój sposób podróżowania',
    'Kamper, campervan czy przyczepa?',
    'Porównaj sposoby podróżowania przed rezerwacją.',
  ],
  [
    'co-zabrac',
    'Przed odbiorem kluczy',
    'Co zabrać w drogę?',
    'Sprawdź wyposażenie pojazdu i przygotuj własną listę.',
  ],
];

/** Campaign photography is separate from real vehicle photographs supplied by the API. */
export function HeyvansHome({
  catalog,
  error,
  searchForm,
}: {
  catalog: Row[] | null;
  error: string;
  searchForm: ReactNode;
}) {
  return (
    <div className="hey-home">
      <section className="hey-hero container" aria-labelledby="hey-hero-title">
        <div className="hey-hero-copy">
          <p className="eyebrow">Kampery i przyczepy do wynajęcia</p>
          <h1 id="hey-hero-title">
            Hej, po
            <br />
            przygodę.
          </h1>
          <p className="hey-hero-deck">Twoja baza. Twój następny ruch.</p>
          <p className="hey-intro">
            Wynajmij kampera lub przyczepę. Zrób sobie bazę na szlak, dzień nad wodą albo weekend
            poza miastem.
          </p>
          <Link className="text-link" href="/pojazdy">
            Zobacz pojazdy <ArrowUpRight size={20} />
          </Link>
        </div>
        <figure className="hey-hero-picture">
          <img
            src="/assets/heyvans/heyvans-color-hero.webp"
            alt="Ekipa z deskami surfingowymi przy campervanie — fotografia koncepcyjna"
            width={1536}
            height={1024}
            fetchPriority="high"
          />
          <figcaption>
            <span>01 / Zrób sobie bazę</span>
            <span>Dalej zaczyna się przygoda.</span>
          </figcaption>
        </figure>
      </section>
      <div className="hey-search-area container">
        {searchForm}
        <p className="hey-search-hint">
          Jeszcze wybierasz kierunek? <Link href="/odkrywaj">Zobacz pomysły na wyjazd.</Link>
        </p>
      </div>
      <div className="hey-benefits container">
        {[
          ['Porównaj pojazdy', 'Rodzaje, wyposażenie i miejsca do spania.'],
          ['Sprawdź termin', 'Cena i dostępność na wybrane daty.'],
          ['Poznaj zasady', 'Najem, dodatki i kaucja osobno.'],
          ['Zapytaj wypożyczalnię', 'Ustal szczegóły przed odbiorem.'],
        ].map(([title, text], index) => (
          <div key={title}>
            <span className="hey-number">0{index + 1}</span>
            <p>
              <strong>{title}</strong>
              <span>{text}</span>
            </p>
          </div>
        ))}
      </div>
      <section className="hey-vehicles container hey-section" aria-labelledby="hey-vehicle-title">
        <div className="hey-section-heading">
          <div>
            <p className="eyebrow">01 / Kampery i przyczepy</p>
            <h2 id="hey-vehicle-title">
              Dobierz bazę
              <br />
              do swojego planu.
            </h2>
          </div>
          <Link className="text-link" href="/pojazdy">
            Wszystkie pojazdy <ArrowUpRight size={20} />
          </Link>
        </div>
        <div className="hey-types">
          {types.slice(1).map(([id, label, image], index) => (
            <Link key={id} href={'/pojazdy?type=' + id}>
              <div className="hey-type-image">
                <img src={asset(image)} alt="" loading="lazy" />
              </div>
              <h3>
                {label}
                <ArrowUpRight size={18} />
              </h3>
              <p>{categories[index]}</p>
            </Link>
          ))}
        </div>
        <div className="hey-catalog-heading">
          <p className="eyebrow">Wybierz pojazd na wyjazd</p>
          <h2>Który jedzie z Tobą?</h2>
          <p>Wybierz termin i porównaj cenę, wyposażenie oraz dostępność.</p>
        </div>
        <DataState data={catalog} error={error}>
          <div className="vehicle-grid three">
            {catalog?.slice(0, 3).map((vehicle) => (
              <Card key={vehicle.id} v={{ ...vehicle, total_minor: null }} />
            ))}
          </div>
        </DataState>
        <p className="sample-note" data-nosnippet>
          Oferty przykładowe.
        </p>
      </section>
      <section className="hey-inspiration hey-section" aria-labelledby="hey-ideas-title">
        <div className="container hey-inspiration-layout">
          <div>
            <p className="eyebrow">02 / Kierunki</p>
            <h2 id="hey-ideas-title">
              Na szlak.
              <br />
              Nad wodę.
              <br />
              Przed siebie.
            </h2>
            <p>
              Weekend poza miastem czy kilka dni w trasie? Zobacz pomysły na wyjazd i znajdź
              kierunek dla siebie.
            </p>
            <Link className="btn secondary" href="/odkrywaj">
              Zobacz pomysły na wyjazd <ArrowUpRight size={20} />
            </Link>
          </div>
          <figure>
            <img
              src="/assets/heyvans/heyvans-color-surf.webp"
              alt="Surferka na fali — fotografia koncepcyjna kierunku podróży"
              loading="lazy"
              width={1536}
              height={1024}
            />
            <figcaption>Wybierz kierunek. Reszta jest przed Tobą.</figcaption>
          </figure>
        </div>
      </section>
      <section className="hey-camps container hey-section" aria-labelledby="hey-camps-title">
        <figure>
          <img
            src="/assets/heyvans/heyvans-color-trail.webp"
            alt="Rowerzysta ruszający na szlak od leśnej bazy z kamperem — fotografia koncepcyjna"
            loading="lazy"
            width={1536}
            height={1024}
          />
          <figcaption>03 / Nocleg przed następnym ruchem</figcaption>
        </figure>
        <div>
          <p className="eyebrow">Kempingi i pola namiotowe</p>
          <h2 id="hey-camps-title">
            Gdzie
            <br />
            robisz bazę?
          </h2>
          <p>Wyszukaj kemping w wybranym regionie. Sprawdź dojazd, zasady i zaplanuj nocleg.</p>
          <Link className="btn primary" href="/kempingi">
            Zobacz kempingi <ArrowUpRight size={20} />
          </Link>
        </div>
      </section>
      <section className="hey-guides container hey-section" aria-labelledby="hey-guides-title">
        <div className="hey-section-heading">
          <div>
            <p className="eyebrow">04 / Poradniki</p>
            <h2 id="hey-guides-title">
              Pierwszy wyjazd?
              <br />
              Ogarnij podstawy.
            </h2>
            <p>Wybór pojazdu, pakowanie, odbiór kluczy. Sprawdź, co przygotować, zanim ruszysz.</p>
          </div>
          <Link className="text-link" href="/poradniki">
            Wszystkie poradniki <ArrowUpRight size={20} />
          </Link>
        </div>
        <div className="hey-guide-grid">
          {guides.map(([id, eyebrow, title, text], index) => (
            <Link href={'/artykul/' + id} key={id}>
              <span className="hey-guide-number">
                0{index + 1}
                <ArrowUpRight size={26} />
              </span>
              <p className="eyebrow">{eyebrow}</p>
              <h3>{title}</h3>
              <p>{text}</p>
            </Link>
          ))}
        </div>
      </section>
      <section className="hey-owner" aria-labelledby="hey-owner-title">
        <div className="container hey-owner-layout">
          <div className="hey-owner-word" aria-hidden="true">
            hey,
            <br />
            <span>partner/</span>
          </div>
          <div>
            <p className="eyebrow">05 / Dla wypożyczalni</p>
            <h2 id="hey-owner-title">
              Twoja flota.
              <br />
              Ich następny wyjazd.
            </h2>
            <p>
              Pokaż ofertę podróżnikom. Zarządzaj pojazdami, kalendarzem i rezerwacjami w panelu
              wypożyczalni.
            </p>
            <Link className="btn secondary" href="/dla-firm">
              Poznaj panel wypożyczalni <ArrowUpRight size={20} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
