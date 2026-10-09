import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Camperfolks — Do zobaczenia w drodze.',
    short_name: 'Camperfolks',
    description: 'Kampery, przyczepy, poradniki i pomysły na wyjazd w swoim tempie.',
    lang: 'pl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#F5EFDF',
    theme_color: '#15323B',
    icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
