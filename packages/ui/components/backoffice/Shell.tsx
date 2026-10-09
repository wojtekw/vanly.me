'use client';
import React from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  CalendarDays,
  CarFront,
  Package,
  Settings,
  MessageCircle,
  Users,
  ShieldCheck,
  FileText,
  LifeBuoy,
  Activity,
  ArrowRight,
} from 'lucide-react';
import { Row, Heading } from '../shared';
import { canonicalPanelPath } from '../../portal-routes.mjs';

const ownerTabs = [
  ['pulpit', 'Dzisiaj', LayoutDashboard],
  ['kalendarz', 'Kalendarz', CalendarDays],
  ['rezerwacje', 'Rezerwacje', FileText],
  ['flota', 'Moja flota', CarFront],
  ['magazyn', 'Wyposażenie', Package],
  ['wiadomosci', 'Wiadomości', MessageCircle],
  ['komentarze', 'Pytania i opinie', MessageCircle],
  ['zespol', 'Zespół', Users],
  ['ustawienia', 'Zasady i ceny', Settings],
];
const adminTabs = [
  ['pulpit', 'Przegląd', LayoutDashboard],
  ['rezerwacje', 'Rezerwacje i zwroty', FileText],
  ['firmy', 'Firmy', CarFront],
  ['moderacja', 'Moderacja', ShieldCheck],
  ['zgloszenia', 'Zgłoszenia', LifeBuoy],
  ['tresci', 'Treści serwisu', FileText],
  ['system', 'Integracje i zadania', Activity],
  ['historia', 'Historia zmian', CalendarDays],
];
export function Shell({
  admin = false,
  tab,
  children,
  company,
}: {
  admin?: boolean;
  tab: string;
  children: React.ReactNode;
  company?: Row;
}) {
  return (
    <div className="container backoffice-container">
      <Heading
        eyebrow={admin ? 'Vanly / panel operatora' : 'Vanly / panel wypożyczalni'}
        title={admin ? 'Dobre wyjazdy pod kontrolą.' : company?.name || 'Twoja wypożyczalnia.'}
      >
        <div className="inline">
          <span className="muted">
            {admin
              ? 'Rezerwacje, firmy i obsługa całego serwisu.'
              : 'Codzienna obsługa Twojej floty'}
          </span>
          {!admin && company && (
            <span className={'pill ' + (company.verified ? 'good' : 'warn')}>
              {company.verified ? 'Firma zweryfikowana' : 'Czeka na weryfikację'}
            </span>
          )}
          <Link className="text-link" href="/konto">
            Konto podróżnika <ArrowRight size={15} />
          </Link>
        </div>
      </Heading>
      <div className="office-layout">
        <aside className="office-sidebar">
          <nav className="side-nav" aria-label={admin ? 'Panel operatora' : 'Panel firmy'}>
            {(admin ? adminTabs : ownerTabs).map(([id, title, Icon]: any) => (
              <Link
                className={tab === id || (tab === 'pojazd' && id === 'flota') ? 'active' : ''}
                key={id}
                href={canonicalPanelPath((admin ? '/operator/' : '/company/') + id)}
              >
                <Icon size={19} />
                {title}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="office-main">{children}</div>
      </div>
    </div>
  );
}
