/** Public presentation only. API routes, legal entities and data stay shared. */
const brands = {
  vanly: {
    id: 'vanly',
    name: 'Vanly',
    wordmark: 'Vanly.me',
    tagline: 'Jedź po swoje!',
    siteUrl: 'https://vanly.me',
    logoDark: '/assets/logo-dark.png',
    logoWidth: 2138,
    logoHeight: 368,
    logoLight: '/assets/logo-light.png',
    favicon: '/favicon.svg',
    shareImage: '/assets/hero.webp',
  },
  camperfolks: {
    id: 'camperfolks',
    name: 'Camperfolks',
    wordmark: 'camper folks',
    tagline: 'Do zobaczenia w drodze.',
    siteUrl: 'https://camperfolks.com.local',
    logoDark: '/assets/camperfolks/camperfolks-patch-logo-480.webp',
    logoWidth: 480,
    logoHeight: 227,
    logoLight: '/assets/camperfolks/camperfolks-patch-logo-480.webp',
    favicon: '/assets/camperfolks/favicon.svg',
    shareImage: '/assets/camperfolks/share-patch.png',
  },
  heyvans: {
    id: 'heyvans',
    name: 'heyvans',
    wordmark: 'heyvans',
    tagline: 'Hej, po przygodę.',
    siteUrl: 'https://heyvans.com.local',
    logoDark: '/assets/heyvans/logo-dark.svg',
    logoWidth: 360,
    logoHeight: 90,
    logoLight: '/assets/heyvans/logo-light.svg',
    favicon: '/assets/heyvans/favicon.svg',
    shareImage: '/assets/heyvans/share.png',
  },
} as const;

export type PortalBrand = keyof typeof brands;
const configuredBrand = process.env.NEXT_PUBLIC_PORTAL_BRAND;
export const portalBrand: PortalBrand =
  configuredBrand === 'camperfolks' || configuredBrand === 'heyvans' ? configuredBrand : 'vanly';
export const isCamperfolks = portalBrand === 'camperfolks';
export const isHeyvans = portalBrand === 'heyvans';
export const brand = brands[portalBrand];
