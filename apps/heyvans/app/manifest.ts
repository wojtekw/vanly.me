import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'heyvans — Hej, po przygodę.',
    short_name: 'heyvans',
    description: 'Twoja baza. Twój następny ruch. Kampery i przyczepy na Twoją kolejną przygodę.',
    lang: 'pl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F0EFE9',
    theme_color: '#141615',
    icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
