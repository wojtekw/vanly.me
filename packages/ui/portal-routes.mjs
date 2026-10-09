const companyTabs = {
  pulpit: 'dashboard',
  kalendarz: 'calendar',
  rezerwacje: 'bookings',
  rezerwacja: 'booking',
  flota: 'fleet',
  magazyn: 'inventory',
  wiadomosci: 'messages',
  komentarze: 'reviews',
  zespol: 'team',
  ustawienia: 'settings',
  pojazd: 'vehicle',
};
const operatorTabs = {
  pulpit: 'dashboard',
  rezerwacje: 'bookings',
  rezerwacja: 'booking',
  firmy: 'companies',
  moderacja: 'moderation',
  zgloszenia: 'reports',
  tresci: 'content',
  system: 'system',
  historia: 'history',
};

function splitPath(href) {
  const suffixAt = href.search(/[?#]/);
  return suffixAt < 0 ? [href, ''] : [href.slice(0, suffixAt), href.slice(suffixAt)];
}

/** Canonicalize route segments only; booking/vehicle IDs, queries and hashes stay intact. */
export function canonicalPanelPath(href) {
  const [pathname, suffix] = splitPath(href);
  const parts = pathname.split('/');
  if (parts[0] !== '') return href;
  if (parts[1] === 'logowanie') parts[1] = 'login';
  if (parts[1] === 'firma' || parts[1] === 'company') {
    parts[1] = 'company';
    if (Object.hasOwn(companyTabs, parts[2])) parts[2] = companyTabs[parts[2]];
    if (parts[2] === 'vehicle' && parts[3] === 'nowy') parts[3] = 'new';
  } else if (parts[1] === 'operator') {
    if (Object.hasOwn(operatorTabs, parts[2])) parts[2] = operatorTabs[parts[2]];
  }
  return parts.join('/') + suffix;
}

export function isPanelPath(href) {
  const [pathname] = splitPath(href);
  return /^\/(?:company|firma|operator)(?:\/|$)/.test(pathname);
}

/** Ordered aliases for server redirects; append portal-prefix catchalls after these. */
export const panelRedirects = [
  ...['firma', 'company'].flatMap(prefix => ['pojazd', 'vehicle'].map(tab => ({
    source: `/${prefix}/${tab}/nowy/:path*`,
    destination: '/company/vehicle/new/:path*',
    kind: 'owner',
  }))),
  ...['firma', 'company'].flatMap(prefix => Object.entries(companyTabs).map(([legacy, canonical]) => ({
    source: `/${prefix}/${legacy}/:path*`,
    destination: `/company/${canonical}/:path*`,
    kind: 'owner',
  }))),
  ...Object.entries(operatorTabs).filter(([legacy, canonical]) => legacy !== canonical).map(([legacy, canonical]) => ({
    source: `/operator/${legacy}/:path*`,
    destination: `/operator/${canonical}/:path*`,
    kind: 'admin',
  })),
];

/** Decode canonical URLs to the existing UI tab identifiers. */
export function panelRoute(href, kind) {
  const [pathname] = splitPath(canonicalPanelPath(href));
  const parts = pathname.split('/');
  const prefix = kind === 'owner' ? 'company' : 'operator';
  const tabs = kind === 'owner' ? companyTabs : operatorTabs;
  const segment = parts[1] === prefix ? parts[2] : undefined;
  const tab = Object.entries(tabs).find(([, value]) => value === segment)?.[0];
  return { tab: tab || 'pulpit', id: parts[1] === prefix ? parts[3] : undefined };
}
