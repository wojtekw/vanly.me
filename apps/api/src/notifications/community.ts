import { createHash } from 'node:crypto';
import { NotificationDb } from './queue';
import { notifyStatus } from './format';

// Version keys identify a persisted public reply / resolution without retaining its text.
const version = (value: string) => createHash('sha256').update(value).digest('hex');
export function notifyPublicReply(
  db: NotificationDb,
  comment: { id: string; author_id: string; vehicle_id: string },
  reply: string,
) {
  return notifyStatus(db, {
    userId: comment.author_id, eventKey: `comment.reply:${comment.id}:${version(reply)}`,
    subject: 'Wypożyczalnia odpowiedziała na Twój wpis', category: 'PYTANIA I OPINIE',
    intro: 'Na ofercie pojawiła się odpowiedź na Twój wpis.',
    details: 'Przeczytaj odpowiedź w VANLY.',
    nextStep: 'Nie podawaj danych prywatnych w publicznym pytaniu lub opinii.',
    cta: 'Zobacz odpowiedź', path: '/pojazd/' + encodeURIComponent(comment.vehicle_id),
  });
}
export function notifyReportUpdated(
  db: NotificationDb,
  report: { id: string; user_id: string; status: string; subject: string; resolution: string },
) {
  return notifyStatus(db, {
    userId: report.user_id,
    eventKey: `report.updated:${report.id}:${version(report.status + ':' + report.resolution)}`,
    subject: report.status === 'resolved' ? 'Zakończyliśmy obsługę Twojego zgłoszenia' : 'Aktualizacja Twojego zgłoszenia',
    category: 'POMOC VANLY',
    intro: report.status === 'resolved' ? 'W zgłoszeniu pojawiło się rozwiązanie.' : 'W zgłoszeniu pojawiła się odpowiedź.',
    details: 'Otwórz zgłoszenie na koncie, aby przeczytać odpowiedź i dalsze kroki.',
    nextStep: 'Treść sprawy i odpowiedź pozostają dostępne po zalogowaniu.',
    cta: 'Sprawdź zgłoszenie', path: '/konto/pomoc',
  });
}

export function notifyPrivateMessage(
  db: NotificationDb,
  message: { id: string; vehicle_id: string },
  recipientId: string,
  audience: 'traveler' | 'owner',
) {
  return notifyStatus(db, {
    userId: recipientId, eventKey: 'message.created:' + message.id,
    subject: audience === 'traveler' ? 'Nowa wiadomość od wypożyczalni' : 'Nowa wiadomość od podróżującego',
    category: 'WIADOMOŚCI VANLY',
    intro: 'W Twojej rozmowie pojawiła się nowa wiadomość.',
    details: 'Otwórz wiadomości w VANLY, aby przeczytać treść i odpowiedzieć.',
    nextStep: 'Treść prywatnej rozmowy jest dostępna po zalogowaniu.',
    cta: 'Otwórz wiadomości',
    path: audience === 'traveler' ? '/konto/wiadomosci' : '/company/messages',
  });
}
