import { enqueueMail, NotificationDb } from './queue';
import { notificationUrl, notifyStatus } from './format';

export function notifyWelcome(db: NotificationDb, account: { id: string; name: string }) {
  return notifyStatus(db, {
    userId: account.id, eventKey: `account.created:${account.id}`,
    subject: 'Witaj w VANLY', category: 'TWOJE KONTO', firstName: account.name.split(' ')[0],
    intro: 'Twoje konto jest gotowe.',
    details: 'Możesz zapisywać ulubione pojazdy, kontaktować się z wypożyczalniami i sprawdzać swoje rezerwacje.',
    nextStep: 'Wszystkie informacje o wyjeździe znajdziesz na swoim koncie.',
    cta: 'Otwórz konto', path: '/konto',
    senderKind: 'no-reply',
  });
}

export function notifyPasswordReset(
  db: NotificationDb,
  account: { id: string; name: string },
  reset: { token: string; tokenHash: string; expiresAt: string; origin?: string },
) {
  const actionUrl = notificationUrl('/reset?token=' + encodeURIComponent(reset.token), reset.origin);
  return enqueueMail(db, account.id, 'VANLY — ustaw nowe hasło',
    `Otrzymaliśmy prośbę o ustawienie nowego hasła. Link jest ważny przez 30 minut.\n\n${actionUrl}\n\nJeśli to nie Twoja prośba, pomiń wiadomość.`,
    {
      eventKey: 'account.password_reset:' + reset.tokenHash,
      template: '02-reset-hasla', expiresAt: reset.expiresAt,
      senderKind: 'no-reply',
      notificationGuard: { kind: 'password-reset', tokenHash: reset.tokenHash },
      variables: {
        first_name: account.name.split(' ')[0], action_url: actionUrl,
        reset_expires_at: new Intl.DateTimeFormat('pl-PL', {
          dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Warsaw',
        }).format(new Date(reset.expiresAt)),
      },
    },
  );
}

export function notifyPasswordChanged(db: NotificationDb, userId: string, tokenHash: string) {
  return notifyStatus(db, {
    userId, eventKey: 'account.password_changed:' + tokenHash,
    subject: 'Hasło do konta VANLY zostało zmienione', category: 'BEZPIECZEŃSTWO KONTA',
    intro: 'Hasło zostało zmienione. Dotychczasowe sesje zostały zakończone.',
    details: 'Jeśli nie wykonujesz tej zmiany, skontaktuj się z pomocą VANLY.',
    nextStep: 'Zaloguj się ponownie, aby korzystać z konta.',
    cta: 'Otwórz konto', path: '/logowanie',
    senderKind: 'no-reply',
  });
}
