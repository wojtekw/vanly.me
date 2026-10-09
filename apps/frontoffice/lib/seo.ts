import type { Metadata } from 'next';
import { brand, isCamperfolks, isHeyvans } from './brand';
import { serviceInfoPages, serviceInfoKindForPath } from './service-info';

export type SearchParams = Record<string, string | string[] | undefined>;
export type SeoRoute = {
  pathname: string;
  kind:
    | 'home'
    | 'search'
    | 'vehicle'
    | 'guides'
    | 'discover'
    | 'article'
    | 'camps'
    | 'owners'
    | 'privacy'
    | 'service-info'
    | 'private';
  publicPage: boolean;
  id?: string;
};
type RecordData = Record<string, any>;

export const publicPaths = [
  '/',
  '/pojazdy',
  '/poradniki',
  '/odkrywaj',
  '/kempingi',
  '/dla-firm',
  '/mapy-i-prywatnosc',
  ...Object.values(serviceInfoPages).map((page) => page.path),
];

export function getSeoConfig() {
  const configuredUrl = new URL(process.env.SEO_SITE_URL || brand.siteUrl);
  if (!['http:', 'https:'].includes(configuredUrl.protocol)) {
    throw new Error('SEO_SITE_URL must use HTTP or HTTPS.');
  }
  return {
    siteUrl: configuredUrl.origin,
    indexingEnabled: process.env.SEO_INDEXING_ENABLED === 'true',
  };
}

const singletons: Record<string, SeoRoute['kind']> = {
  pojazdy: 'search',
  poradniki: 'guides',
  odkrywaj: 'discover',
  kempingi: 'camps',
  'dla-firm': 'owners',
  'mapy-i-prywatnosc': 'privacy',
  ...Object.fromEntries(
    Object.values(serviceInfoPages).map((page) => [page.path.slice(1), 'service-info']),
  ),
};
const privateSingletons = new Set([
  'logowanie',
  'rejestracja',
  'reset',
  'potwierdz-email',
  'ulubione',
  'porownaj',
  'o-wersji',
]);
const accountTabs = new Set(['podroze', 'wiadomosci', 'dokumenty', 'profil', 'skrzynka', 'pomoc']);
const validId = (id: string | undefined) =>
  Boolean(id && /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,199}$/u.test(id));
const validBookingId = (id: string | undefined) =>
  Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

export function resolveRoute(path: string[] = []): SeoRoute | null {
  const pathname = '/' + path.map(encodeURIComponent).join('/');
  if (!path.length) return { pathname, kind: 'home', publicPage: true };
  if (path.length === 1 && singletons[path[0]]) {
    return { pathname, kind: singletons[path[0]], publicPage: true };
  }
  if (path.length === 2 && ['pojazd', 'artykul'].includes(path[0]) && validId(path[1])) {
    return {
      pathname,
      kind: path[0] === 'pojazd' ? 'vehicle' : 'article',
      publicPage: true,
      id: path[1],
    };
  }
  if (
    (path.length === 1 && privateSingletons.has(path[0])) ||
    (path.length === 2 &&
      path[0] === 'newsletter' &&
      ['potwierdz', 'rezygnacja'].includes(path[1])) ||
    (path.length === 2 && path[0] === 'dla-firm' && path[1] === 'rejestracja') ||
    (path[0] === 'konto' &&
      (path.length === 1 || (path.length === 2 && accountTabs.has(path[1])))) ||
    (path[0] === 'rezerwacja' && path.length === 2 && validBookingId(path[1])) ||
    (path[0] === 'konto' &&
      path[1] === 'rezerwacja' &&
      path.length === 3 &&
      validBookingId(path[2])) ||
    ['firma', 'company', 'operator'].includes(path[0])
  )
    return { pathname, kind: 'private', publicPage: false };
  return null;
}

export function searchCatalogPath(params: SearchParams = {}) {
  const query = new URLSearchParams();
  const value = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  for (const key of ['location', 'start', 'end', 'guests']) {
    const input = value(key);
    if (input) query.set(key, input);
  }
  query.set('type', value('type') || 'all');
  query.set('sort', 'recommended');
  query.set('radius', '50');
  return '/catalog?' + query;
}

const text = (value: unknown) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
const shorten = (value: unknown, length = 170) => {
  const clean = text(value);
  return clean.length > length ? clean.slice(0, length - 1).replace(/\s+\S*$/, '') + '…' : clean;
};
const absolute = (pathname: string) => new URL(pathname, getSeoConfig().siteUrl).toString();
export function publicAssetUrl(asset?: string) {
  return absolute(asset?.startsWith('/') ? asset : '/assets/' + (asset || 'hero.webp'));
}

const pageCopy: Record<
  string,
  { title: string; description: string; name: string; image?: string }
> = {
  home: {
    title: 'Vanly — wynajem kamperów i przyczep | Jedź po swoje',
    description:
      'Kampery i przyczepy na wyjazd w Twoim tempie. Znajdź pojazd, odkryj pomysły na podróż i przygotuj się do drogi z Vanly.',
    name: 'Vanly',
  },
  search: {
    title: 'Wynajem kamperów i przyczep — znajdź pojazd | Vanly',
    description:
      'Znajdź kampera lub przyczepę na swoją trasę. Porównaj wyposażenie, liczbę miejsc i warunki wynajmu, wybierz termin i ruszaj w swoim tempie.',
    name: 'Kampery i przyczepy',
  },
  guides: {
    title: 'Poradniki o kamperach i przyczepach — przed wyjazdem | Vanly',
    description:
      'Od wyboru pojazdu po zwrot kluczyków. Praktyczne poradniki o wynajmie kampera, wyposażeniu, planowaniu trasy i podróży z przyczepą.',
    name: 'Poradniki',
    image: 'guides/01-pierwszy-wyjazd.webp',
  },
  discover: {
    title: 'Pomysły na podróż kamperem i przyczepą | Vanly',
    description:
      'Odkrywaj pomysły i proste wskazówki na wyjazd we własnym tempie. Zostaw w planie miejsce na spontaniczność i znajdź inspirację na swoją trasę.',
    name: 'Odkrywaj',
    image: 'trip.webp',
  },
  camps: {
    title: 'Kempingi i miejsca na nocleg w podróży | Vanly',
    description:
      'Znajdź kemping i pomysł na przystanek w podróży kamperem lub z przyczepą. Zaplanuj nocleg na swojej trasie.',
    name: 'Kempingi',
    image: 'campsite.webp',
  },
  owners: {
    title: 'Vanly dla wypożyczalni kamperów i przyczep',
    description:
      'Pokaż swoją flotę podróżnikom w Vanly. Poznaj miejsce dla wypożyczalni kamperów i przyczep oraz obsługi ofert i rezerwacji.',
    name: 'Dla wypożyczalni',
    image: 'owners.webp',
  },
  privacy: {
    title: 'Mapy i prywatność — zasady korzystania | Vanly',
    description:
      'Sprawdź zasady korzystania z map w Vanly i informacje o prywatności podczas wyszukiwania kempingów.',
    name: 'Mapy i prywatność',
  },
  private: {
    title: 'Twoje konto i podróże | Vanly',
    description: 'Zaloguj się do Vanly i zarządzaj swoimi podróżami.',
    name: 'Vanly',
  },
};

function copyForRoute(route: SeoRoute, record?: RecordData) {
  const infoKind = serviceInfoKindForPath(route.pathname);
  if (route.kind === 'service-info' && infoKind) {
    const info = serviceInfoPages[infoKind];
    return {
      title: `${info.title} | ${brand.name}`,
      description: info.description,
      name: info.title,
    };
  }
  if (route.pathname === '/dla-firm/rejestracja') {
    return {
      title: `Dodaj wypożyczalnię | ${brand.name}`,
      description: 'Podaj dane wypożyczalni i przygotuj swoją flotę do publikacji ofert.',
      name: 'Dodaj wypożyczalnię',
    };
  }
  if (route.kind === 'vehicle' && record) {
    const location = text(record.city);
    return {
      title: `${text(record.name)}${location ? ' — wynajem, ' + location : ''} | ${brand.name}`,
      description: shorten(
        record.description ||
          record.tagline ||
          `${record.name}. Sprawdź wyposażenie i warunki wynajmu w ${brand.name}.`,
      ),
      name: text(record.name),
      image: record.asset,
    };
  }
  if (route.kind === 'article' && record) {
    return {
      title: `${text(record.title)} | ${brand.name}`,
      description: shorten(record.summary),
      name: text(record.title),
      image: record.asset,
    };
  }
  const copy = pageCopy[route.kind] || pageCopy.private;
  if (isHeyvans && route.kind === 'home')
    return {
      title: 'heyvans — wynajem kamperów i przyczep | Hej, po przygodę.',
      description:
        'Twoja baza. Twój następny ruch. Wynajmij kampera lub przyczepę na szlak, dzień nad wodą albo weekend poza miastem. Znajdź pojazd, kemping i poradniki z heyvans.',
      name: brand.name,
      image: brand.shareImage,
    };
  if (!isCamperfolks && !isHeyvans) return copy;
  if (route.kind === 'home')
    return {
      title: 'Camperfolks — wynajem kamperów i przyczep | Do zobaczenia w drodze',
      description:
        'Znajdź kampera lub przyczepę na wyjazd w swoim tempie. Zajrzyj do poradników, odkryj pomysły na drogę i wybierz miejsce na nocleg z Camperfolks.',
      name: brand.name,
      image: brand.shareImage,
    };
  return {
    ...copy,
    title: copy.title.replaceAll('Vanly', brand.name),
    description: copy.description.replaceAll('Vanly', brand.name),
    name: copy.name === 'Vanly' ? brand.name : copy.name,
  };
}

export function buildMetadata(route: SeoRoute, record?: RecordData, hasQuery = false): Metadata {
  const copy = copyForRoute(route, record);
  const canonical = absolute(route.pathname);
  const index =
    getSeoConfig().indexingEnabled && route.publicPage && !(route.kind === 'search' && hasQuery);
  const image = publicAssetUrl(copy.image || (brand.id !== 'vanly' ? brand.shareImage : undefined));
  return {
    title: copy.title,
    description: copy.description,
    alternates: { canonical },
    robots: {
      index,
      follow: route.publicPage,
      googleBot: { index, follow: route.publicPage, 'max-image-preview': 'large' },
    },
    openGraph: {
      type: route.kind === 'article' ? 'article' : 'website',
      title: copy.title,
      description: copy.description,
      url: canonical,
      siteName: brand.name,
      locale: 'pl_PL',
      images: [{ url: image }],
    },
    twitter: {
      card: 'summary_large_image',
      title: copy.title,
      description: copy.description,
      images: [image],
    },
  };
}

export function jsonLdForPage(route: SeoRoute, record?: RecordData): RecordData[] {
  if (!route.publicPage) return [];
  const siteUrl = getSeoConfig().siteUrl;
  const copy = copyForRoute(route, record);
  const organization = {
    '@type': 'Organization',
    '@id': siteUrl + '/#organization',
    name: brand.name,
    url: siteUrl + '/',
    logo: publicAssetUrl(brand.logoDark),
  };
  if (route.kind === 'home') {
    return [
      { '@context': 'https://schema.org', ...organization },
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        '@id': siteUrl + '/#website',
        name: brand.name,
        alternateName: isHeyvans ? 'heyvans.com' : isCamperfolks ? 'camperfolks.' : 'vanly.me',
        url: siteUrl + '/',
        inLanguage: 'pl-PL',
        publisher: { '@id': organization['@id'] },
      },
    ];
  }
  const breadcrumbs: RecordData[] = [
    { '@type': 'ListItem', position: 1, name: brand.name, item: siteUrl + '/' },
  ];
  if (route.kind === 'vehicle')
    breadcrumbs.push({
      '@type': 'ListItem',
      position: 2,
      name: pageCopy.search.name,
      item: absolute('/pojazdy'),
    });
  if (route.kind === 'article' && record) {
    const parent = record.kind === 'guide' ? 'guides' : 'discover';
    breadcrumbs.push({
      '@type': 'ListItem',
      position: 2,
      name: pageCopy[parent].name,
      item: absolute(parent === 'guides' ? '/poradniki' : '/odkrywaj'),
    });
  }
  breadcrumbs.push({
    '@type': 'ListItem',
    position: breadcrumbs.length + 1,
    name: copy.name,
    item: absolute(route.pathname),
  });
  const data: RecordData[] = [
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: breadcrumbs },
  ];
  if (route.kind === 'article' && record) {
    const updatedAt = record.updated_at && new Date(record.updated_at);
    data.push({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: text(record.title),
      description: text(record.summary),
      image: publicAssetUrl(record.asset),
      mainEntityOfPage: absolute(route.pathname),
      inLanguage: 'pl-PL',
      ...(updatedAt && !Number.isNaN(updatedAt.getTime())
        ? { dateModified: updatedAt.toISOString() }
        : {}),
      publisher: organization,
    });
  }
  return data;
}

export const serializeJsonLd = (data: RecordData) => JSON.stringify(data).replace(/</g, '\\u003c');
