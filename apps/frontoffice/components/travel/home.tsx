'use client';
import React from 'react';
import Link from 'next/link';
import { brand, isCamperfolks, isHeyvans } from '../../lib/brand';
import { HeyvansHome } from '../HeyvansHome';
import {
  ArrowRight,
  MapPin,
  CalendarDays,
  ShieldCheck,
  Compass,
  MessageCircle,
  CheckCircle2,
} from 'lucide-react';
import { Row, useData, DataState, Card, asset, types } from '../shared';
import { SearchForm } from './search-form';

export function Home() {
  const { data, error } = useData('/catalog');
  if (isHeyvans) return <HeyvansHome catalog={data} error={error} searchForm={<SearchForm />} />;
  return (
    <>
      <section className="hero">
        {isCamperfolks ? (
          <div className="container camper-hero-layout">
            <div className="hero-copy">
              <p className="eyebrow">Kampery, przyczepy i dobre wyjazdy</p>
              <h1 className="handwritten">
                Do zobaczenia <br />w drodze.
              </h1>
              <p className="hero-description">
                Wynajmij kampera lub przyczepę na wyjazd w swoim tempie. A jeśli jedziesz z
                namiotem, zajrzyj do miejsc na nocleg i pomysłów na drogę.
              </p>
              <div className="camper-hero-actions">
                <Link className="btn primary" href="/pojazdy">
                  Zobacz kampery i przyczepy <ArrowRight size={18} />
                </Link>
                <Link className="btn secondary" href="/poradniki">
                  Zajrzyj do poradników <ArrowRight size={18} />
                </Link>
              </div>
              <div className="hero-trust">
                <div>
                  <Compass className="icon" />
                  Kampery i przyczepy
                  <br />
                  Na Twój wyjazd.
                </div>
                <div>
                  <CheckCircle2 className="icon" />
                  Cena i zasady
                  <br />
                  Przed rezerwacją.
                </div>
                <div>
                  <MapPin className="icon" />
                  Poradniki i miejsca
                  <br />
                  Na dobry początek.
                </div>
              </div>
            </div>
            <div className="camper-hero-visual">
              <img
                className="hero-art"
                src="/assets/camperfolks/road-camp.webp"
                alt=""
                width={1200}
                height={500}
              />
            </div>
          </div>
        ) : (
          <>
            <img
              className="hero-art"
              src="/assets/hero.webp"
              alt="Kamper nad jeziorem wśród gór i drzew"
            />
            <div className="container hero-inner">
              <div className="hero-copy">
                <p className="eyebrow">Mniej planowania. Więcej bycia.</p>
                <h1 className="handwritten">
                  Jedź po swoje.
                  <br />
                  Reszta jest po drodze.
                </h1>
                <p className="hero-description">
                  Kampery i przyczepy na wyjazdy w Twoim tempie. Znajdź swój kawałek wolności.
                </p>
                <div className="hero-trust">
                  <div>
                    <Compass className="icon" />
                    Twój kierunek.
                    <br />
                    Twoje tempo.
                  </div>
                  <div>
                    <CheckCircle2 className="icon" />
                    Cena znana
                    <br />
                    przed rezerwacją.
                  </div>
                  <div>
                    <ShieldCheck className="icon" />
                    Wszystko o wyjeździe
                    <br />w jednym miejscu.
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
      <div className="container search-wrap">
        <SearchForm />
        <div className="flexible">
          {isCamperfolks ? 'Najpierw wybór pojazdu?' : 'Jeszcze bez kierunku?'}{' '}
          <Link href="/pojazdy">
            {isCamperfolks ? 'Zobacz kampery i przyczepy' : 'Zobacz wszystkie pojazdy'}{' '}
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
      <section className="benefit-strip">
        <div className="container benefits">
          {(isCamperfolks
            ? [
                [Compass, 'Na Twój wyjazd', 'Porównaj rodzaje i wyposażenie'],
                [CalendarDays, 'Twój termin', 'Sprawdź dostępność pojazdu'],
                [CheckCircle2, 'Zasady przed drogą', 'Najem, dodatki i kaucja osobno'],
                [MessageCircle, 'Zapytaj wypożyczalnię', 'Ustal szczegóły przed odbiorem'],
              ]
            : [
                [Compass, 'Małe i duże wyprawy', 'Pojazd dopasowany do Twojej ekipy'],
                [CalendarDays, 'Dostępne terminy', 'Sprawdź kalendarz i ruszaj dalej'],
                [CheckCircle2, 'Przejrzyste zasady', 'Najem, dodatki i kaucja osobno'],
                [MessageCircle, 'Kontakt z wypożyczalnią', 'Zapytaj przed wyruszeniem'],
              ]
          ).map(([Icon, title, text]: any) => (
            <div className="benefit" key={title}>
              <Icon className="icon" />
              <div>
                <strong>{title}</strong>
                <small>{text}</small>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="categories-section">
        <div className="container">
          <div className="section-head">
            <div>
              <p className="eyebrow">
                {isCamperfolks ? 'Razem albo solo' : 'Jaki masz plan na drogę?'}
              </p>
              <h2>{isCamperfolks ? 'Jak chcesz podróżować?' : 'Każdy jedzie po swojemu.'}</h2>
            </div>
            <Link className="text-link" href="/pojazdy">
              Zobacz pojazdy <ArrowRight size={17} />
            </Link>
          </div>
          <div className="categories">
            {types.slice(1).map(([id, label, img], i) => (
              <Link key={id} className="category" href={'/pojazdy?type=' + id}>
                <div className="category-image">
                  <img src={asset(img)} alt="" />
                </div>
                <div className="spread">
                  <div>
                    <h3>{label}</h3>
                    <p>
                      {
                        (isCamperfolks
                          ? [
                              'Kompaktowo i blisko drogi.',
                              'Więcej miejsca na codzienność.',
                              'Miejsce dla większej ekipy.',
                              'Na mniej oczywiste kierunki.',
                              'Twoja baza na dłuższy postój.',
                            ]
                          : [
                              'Kompaktowo i blisko drogi.',
                              'Więcej miejsca na codzienność.',
                              'Dla rodziny i większej ekipy.',
                              'Na mniej oczywiste kierunki.',
                              'Rozgość się na dłużej.',
                            ])[i]
                      }
                    </p>
                  </div>
                  <ArrowRight size={17} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
      {isCamperfolks && (
        <section className="camper-welcome">
          <div className="container camper-welcome-inner">
            <div>
              <p className="eyebrow">Pierwszy raz też jest dobrym początkiem</p>
              <h2>Przed wyjazdem dobrze wiedzieć.</h2>
              <p>
                Jaki pojazd wybrać? Co spakować? O co zapytać wypożyczalnię? W poradnikach
                znajdziesz wskazówki na pierwszy i kolejny wyjazd.
              </p>
            </div>
            <Link className="btn secondary" href="/poradniki">
              Zajrzyj do poradników <ArrowRight size={18} />
            </Link>
          </div>
        </section>
      )}
      <section className="featured-section container">
        <div className="section-head">
          <div>
            <p className="eyebrow">Który zabierzesz w drogę?</p>
            <h2>
              {isCamperfolks ? 'Znajdź pojazd na swój wyjazd.' : 'Dobry wyjazd zaczyna się tutaj.'}
            </h2>
            <p>
              {isCamperfolks
                ? 'Podaj termin, żeby sprawdzić cenę i dostępność.'
                : 'Wybierz termin, a my sprawdzimy cenę i dostępność.'}
            </p>
          </div>
          <Link className="text-link" href="/pojazdy">
            Wszystkie pojazdy <ArrowRight size={17} />
          </Link>
        </div>
        <DataState data={data} error={error}>
          <div className="vehicle-grid three">
            {data?.slice(0, 3).map((v: Row) => (
              <Card key={v.id} v={{ ...v, total_minor: null }} />
            ))}
          </div>
        </DataState>
        <p className="sample-note" data-nosnippet>
          Oferty przykładowe.
        </p>
      </section>
      <section className="inspiration">
        <div className="container inspiration-grid">
          <div className="trip-feature">
            <img
              src={isCamperfolks ? '/assets/owners.webp' : '/assets/trip.webp'}
              alt={
                isCamperfolks
                  ? 'Podróżniczka rozmawia z gospodarzem przy odbiorze kluczy — ilustracja'
                  : 'Spokojny przystanek nad jeziorem'
              }
            />
            <div className="trip-copy">
              <p className="eyebrow">
                {isCamperfolks ? 'Ludzie, widoki i chwila na postój' : 'Zostaw sobie trochę luzu'}
              </p>
              <h2>
                {isCamperfolks
                  ? 'Zostaw miejsce na dobre spotkania.'
                  : 'Nie każda dobra droga jest najkrótsza.'}
              </h2>
              <p>
                {isCamperfolks
                  ? 'Rozmowa przy odbiorze, kawa na postoju, nowy widok za oknem. Zobacz pomysły na wyjazd bez napiętego planu.'
                  : 'Pomysły na małe ucieczki i wyjazdy bez napiętego planu.'}
              </p>
              <Link className="text-link" href="/odkrywaj">
                {isCamperfolks ? 'Zobacz pomysły na wyjazd' : 'Złap inspirację'}{' '}
                <ArrowRight size={17} />
              </Link>
            </div>
          </div>
          <div className="camp-feature">
            <img src="/assets/campsite.webp" alt="Ilustrowany kemping" />
            <h3>
              {isCamperfolks ? 'Gdzie zatrzymasz się tym razem?' : 'Zostań tam, gdzie jest dobrze.'}
            </h3>
            <p>
              {isCamperfolks
                ? 'Zobacz kempingi i pola namiotowe. Wybierz miejsce na kolejny przystanek.'
                : 'Zobacz mapę miejsc i wybierz swój następny przystanek.'}
            </p>
            <Link className="text-link" href="/kempingi">
              {isCamperfolks ? 'Znajdź miejsce na nocleg' : 'Sprawdź kempingi'}{' '}
              <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </section>
      <section className="owner-banner">
        <div className="container owner-banner-inner">
          <img src="/assets/owners.webp" alt="Przekazanie kluczy do kampera" />
          <div className="owner-banner-copy">
            <p className="eyebrow">Prowadzisz wypożyczalnię?</p>
            <h2>
              Twoja flota.
              <br />
              {isCamperfolks ? 'Pod ręką.' : 'Więcej dobrych wyjazdów.'}
            </h2>
            <p>
              {isCamperfolks
                ? 'Oferty, kalendarz i rezerwacje w panelu Twojej wypożyczalni.'
                : 'Oferty, kalendarz i codzienna obsługa w jednym miejscu.'}
            </p>
            <Link className="btn primary" href="/dla-firm">
              {isCamperfolks ? 'Poznaj panel wypożyczalni' : `Poznaj ${brand.name} dla firm`}{' '}
              <ArrowRight size={17} />
            </Link>
          </div>
          <div className="scribble">
            {isCamperfolks ? 'Ty znasz swoją flotę.' : 'Ty znasz kampery.'}
            <br />
            {isCamperfolks ? 'Tu planujesz jej wyjazdy.' : 'My łączymy drogi.'}
          </div>
        </div>
      </section>
    </>
  );
}
