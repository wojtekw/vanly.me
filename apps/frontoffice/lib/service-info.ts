export type ServiceInfoKind = 'terms' | 'privacy' | 'cookies' | 'help' | 'contact';

export const serviceInfoPages: Record<
  ServiceInfoKind,
  { path: string; title: string; description: string }
> = {
  terms: {
    path: '/regulamin',
    title: 'Regulamin serwisu',
    description:
      'Zasady korzystania z serwisu, kont podróżników i wypożyczalni oraz rezerwacji testowych.',
  },
  privacy: {
    path: '/polityka-prywatnosci',
    title: 'Polityka prywatności',
    description:
      'Informacje o danych użytkowników, ich wykorzystaniu, dostępie i kontakcie z administratorem.',
  },
  cookies: {
    path: '/polityka-cookies',
    title: 'Polityka cookies',
    description: 'Jak działa cookie sesji, jak je usunąć i co warto wiedzieć o usługach map.',
  },
  help: {
    path: '/pomoc',
    title: 'Pomoc',
    description:
      'Odpowiedzi na pytania o konto, rezerwacje, płatności testowe i dodawanie wypożyczalni.',
  },
  contact: {
    path: '/kontakt',
    title: 'Kontakt',
    description:
      'Dane operatora serwisu i sposoby kontaktu w sprawach obsługi, reklamacji i prywatności.',
  },
};

// Public business details verified against the Ministry of Finance VAT register
// by NIP on 2026-10-07. The trading name is also present in public business directories.
export const serviceOperator: {
  name: string;
  person: string;
  address: string;
  nip: string;
  regon: string;
  email?: string;
} = {
  name: 'Wojciech Wydmuch Sales&Product Consulting',
  person: 'Wojciech Wydmuch',
  address: 'ul. Janki Bryla 18/4, 81-577 Gdynia',
  nip: '6342487971',
  regon: '241930650',
  email: 'info@vanly.me',
};

export function serviceInfoKindForPath(pathname: string): ServiceInfoKind | undefined {
  return (Object.keys(serviceInfoPages) as ServiceInfoKind[]).find(
    (kind) => serviceInfoPages[kind].path === pathname,
  );
}
