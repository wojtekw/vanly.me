'use client';
import React from 'react';
import Link from 'next/link';
import guideMetadata from '../../lib/guide-metadata.json';
import { isCamperfolks, isHeyvans } from '../../lib/brand';
import { ArticleText } from '../ArticleText';
import { ArrowRight } from 'lucide-react';
import { Row, useData, DataState, asset } from '../shared';

export function Content({ kind, id }: { kind: string; id?: string }) {
  const { data, error } = useData(
    id ? '/articles/' + id : '/articles' + (kind === 'poradniki' ? '?kind=guide' : ''),
  );
  const guideInfo = (articleId: string) =>
    (
      guideMetadata as Record<
        string,
        { order: number; description: string; alt: string; category: string }
      >
    )[articleId];
  const articles =
    Array.isArray(data) && kind === 'poradniki'
      ? [...data].sort((a, b) => (guideInfo(a.id)?.order ?? 999) - (guideInfo(b.id)?.order ?? 999))
      : data;
  const readingMinutes = (article: Row) =>
    Math.max(
      1,
      Math.ceil(
        [article.title, article.summary, ...article.body.flat()]
          .join(' ')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .trim()
          .split(/\s+/).length / 200,
      ),
    );
  return (
    <div className="container section">
      <DataState data={data} error={error}>
        {data &&
          (id ? (
            <article className="reading">
              <Link className="text-link" href={data.kind === 'guide' ? '/poradniki' : '/odkrywaj'}>
                {data.kind === 'guide' ? '← Wszystkie poradniki' : '← Wszystkie inspiracje'}
              </Link>
              <p className="eyebrow">
                {data.kind === 'guide'
                  ? guideInfo(data.id)?.category || 'Poradnik'
                  : 'Pomysł na wyjazd'}
                {' · '}
                {readingMinutes(data)} min czytania
              </p>
              <h1>{data.title}</h1>
              <p className="lead">{data.summary}</p>
              <img
                className="article-hero"
                src={asset(data.asset)}
                alt={guideInfo(data.id)?.alt || ''}
              />
              {data.body.map(([h, p]: string[], i: number) => (
                <section key={i}>
                  <h2>{h}</h2>
                  <ArticleText text={p} />
                </section>
              ))}
              <Link className="btn primary" href="/pojazdy">
                {isHeyvans
                  ? 'Znajdź bazę na swój wyjazd'
                  : isCamperfolks
                    ? 'Zobacz pojazdy na wyjazd'
                    : 'Znajdź pojazd na swoją trasę'}{' '}
                <ArrowRight size={17} />
              </Link>
            </article>
          ) : (
            <>
              <div className="content-hero">
                <div>
                  <p className="eyebrow">
                    {kind === 'poradniki'
                      ? isHeyvans
                        ? 'Poradniki przed drogą'
                        : isCamperfolks
                          ? 'Mniej niewiadomych przed drogą'
                          : 'Mniej niewiadomych'
                      : isHeyvans
                        ? 'Pomysły na kolejny wyjazd'
                        : isCamperfolks
                          ? 'Nie wszystko musi być w planie'
                          : 'Zostaw w planie miejsce na spontaniczność'}
                  </p>
                  <h1>
                    {kind === 'poradniki'
                      ? isHeyvans
                        ? 'Pierwszy wyjazd? Ogarnij podstawy.'
                        : isCamperfolks
                          ? 'Przygotuj się do wyjazdu.'
                          : 'Przed drogą dobrze wiedzieć.'
                      : isHeyvans
                        ? 'Na szlak. Nad wodę. Przed siebie.'
                        : isCamperfolks
                          ? 'Pomysły na Twoją drogę.'
                          : 'Nie każda dobra droga jest najkrótsza.'}
                  </h1>
                  <p>
                    {kind === 'poradniki'
                      ? isHeyvans
                        ? 'Wybór pojazdu, pakowanie, odbiór kluczy. Sprawdź, co przygotować, zanim ruszysz.'
                        : isCamperfolks
                          ? 'Wybór pojazdu, pakowanie, odbiór i zwrot. Konkretne wskazówki na pierwszy i kolejny wyjazd kamperem lub z przyczepą.'
                          : 'Od wyboru pojazdu po zwrot kluczyków. Praktyczne wskazówki na każdy etap podróży.'
                      : isHeyvans
                        ? 'Weekend poza miastem czy kilka dni w trasie? Zobacz pomysły na wyjazd i znajdź kierunek dla siebie.'
                        : isCamperfolks
                          ? 'Krótki wypad czy dłuższa podróż? Zajrzyj po inspirację i zostaw sobie trochę miejsca na to, co po drodze.'
                          : 'Pomysły i proste wskazówki na wyjazd we własnym tempie.'}
                  </p>
                </div>
                <img
                  src={
                    isHeyvans
                      ? '/assets/heyvans/heyvans-color-' +
                        (kind === 'poradniki' ? 'trail' : 'surf') +
                        '.webp'
                      : kind === 'poradniki'
                        ? '/assets/guides/01-pierwszy-wyjazd.webp'
                        : '/assets/trip.webp'
                  }
                  alt={
                    isHeyvans
                      ? kind === 'poradniki'
                        ? 'Leśna baza z kamperem przed wyjazdem na szlak — fotografia koncepcyjna'
                        : 'Surferka na fali — fotografia koncepcyjna'
                      : kind === 'poradniki'
                        ? guideInfo('first').alt
                        : 'Wypoczynek nad jeziorem'
                  }
                />
              </div>
              <div className="chips">
                <Link className={'chip ' + (kind === 'odkrywaj' ? 'active' : '')} href="/odkrywaj">
                  Inspiracje
                </Link>
                <Link
                  className={'chip ' + (kind === 'poradniki' ? 'active' : '')}
                  href="/poradniki"
                >
                  Poradniki
                </Link>
                <Link className="chip" href="/kempingi">
                  Kempingi
                </Link>
              </div>
              <div className="article-grid">
                {articles.map((a: Row) => (
                  <Link href={'/artykul/' + a.id} className="article-card" key={a.id}>
                    <div className="article-cover">
                      <img src={asset(a.asset)} alt="" loading="lazy" />
                    </div>
                    <div>
                      <p className="eyebrow">
                        {a.kind === 'guide' ? 'Poradnik' : 'Pomysł na wyjazd'} · {readingMinutes(a)}{' '}
                        min
                      </p>
                      <h2>{a.title}</h2>
                      <p>{guideInfo(a.id)?.description || a.summary}</p>
                      <span className="text-link">
                        Czytaj dalej <ArrowRight size={17} />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          ))}
      </DataState>
    </div>
  );
}
