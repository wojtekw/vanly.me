import type { Metadata } from 'next';
import { getSeoConfig } from '../lib/seo';
import { brand, isCamperfolks, isHeyvans } from '../lib/brand';
import './globals.css';
import './heyvans.css';
import '../../../packages/ui/selects.css';
export const metadata: Metadata = {
  metadataBase: new URL(getSeoConfig().siteUrl),
  title: isHeyvans
    ? 'heyvans — wynajem kamperów i przyczep | Hej, po przygodę.'
    : isCamperfolks
      ? 'Camperfolks — wynajem kamperów i przyczep | Do zobaczenia w drodze'
      : `${brand.name} — wynajem kamperów i przyczep`,
  description: isHeyvans
    ? 'Twoja baza. Twój następny ruch. Wynajmij kampera lub przyczepę na szlak, dzień nad wodą albo weekend poza miastem.'
    : isCamperfolks
      ? 'Znajdź kampera lub przyczepę na wyjazd w swoim tempie. Zajrzyj do poradników, odkryj pomysły na drogę i wybierz miejsce na nocleg z Camperfolks.'
      : 'Kampery i przyczepy na wyjazd w Twoim tempie. Jedź po swoje z Vanly.',
  robots: { index: false, follow: true },
  icons: { icon: [{ url: brand.favicon, type: 'image/svg+xml', sizes: '48x48' }] },
  ...(brand.id !== 'vanly' ? { manifest: '/manifest.webmanifest' } : {}),
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" data-brand={brand.id !== 'vanly' ? brand.id : undefined}>
      <body>{children}</body>
    </html>
  );
}
