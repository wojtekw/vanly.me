import { createHash } from 'node:crypto';
import { NotificationDb } from './queue';
import { notifyStatus } from './format';
const version = (s: string) => createHash('sha256').update(s).digest('hex');
export function notifyCommentReceived(
  db: NotificationDb,
  c: { id: string; author_id: string; vehicle_id: string; type: string },
) {
  return notifyStatus(db, {
    userId: c.author_id,
    eventKey: `comment.received:${c.id}`,
    subject: c.type === 'review' ? 'Otrzymaliśmy Twoją opinię' : 'Otrzymaliśmy Twoje pytanie',
    category: 'PYTANIA I OPINIE',
    intro: 'Wpis został zapisany i czeka na moderację.',
    details: 'Po publikacji będzie widoczny na ofercie pojazdu.',
    nextStep: 'Nie umieszczaj danych prywatnych w publicznych wpisach.',
    cta: 'Otwórz ofertę',
    path: '/pojazd/' + encodeURIComponent(c.vehicle_id),
  });
}
export function notifyCommentModerated(
  db: NotificationDb,
  c: { id: string; author_id: string; vehicle_id: string; status: string; reason: string },
) {
  const labels: Record<string, string> = {
    published: 'Twój wpis został opublikowany',
    hidden: 'Twój wpis został ukryty',
    rejected: 'Twój wpis nie został opublikowany',
  };
  return notifyStatus(db, {
    userId: c.author_id,
    eventKey: `comment.moderated:${c.id}:${version(c.status + ':' + c.reason)}`,
    subject: labels[c.status],
    category: 'PYTANIA I OPINIE',
    intro: labels[c.status] + '.',
    details:
      c.status === 'published'
        ? 'Wpis jest dostępny na ofercie pojazdu.'
        : 'Jeśli potrzebujesz wyjaśnienia decyzji, skontaktuj się z pomocą VANLY.',
    nextStep: 'Dane prywatne i sprawy dotyczące rozliczeń przesyłaj przez pomoc lub wiadomości.',
    cta: c.status === 'published' ? 'Otwórz ofertę' : 'Otwórz pomoc',
    path: c.status === 'published' ? '/pojazd/' + encodeURIComponent(c.vehicle_id) : '/konto/pomoc',
  });
}
export async function notifyReportReceived(db: NotificationDb, r: { id: string; user_id: string }) {
  await notifyStatus(db, {
    userId: r.user_id,
    eventKey: `report.received:${r.id}`,
    subject: 'Otrzymaliśmy Twoje zgłoszenie',
    category: 'POMOC VANLY',
    intro: 'Twoje zgłoszenie zostało zapisane.',
    details: 'Odpowiedź i aktualny status znajdziesz na koncie.',
    nextStep: 'Nie wysyłaj kolejnego zgłoszenia w tej samej sprawie.',
    cta: 'Otwórz zgłoszenia',
    path: '/konto/pomoc',
  });
  const admins = (await db.query<{ id: string }>("SELECT id FROM users WHERE role='admin'")).rows;
  for (const admin of admins)
    await notifyStatus(db, {
      userId: admin.id,
      eventKey: `report.received_by_support:${r.id}`,
      subject: 'Nowe zgłoszenie pomocy wymaga obsługi',
      category: 'PANEL VANLY',
      intro: 'Użytkownik przesłał nowe zgłoszenie.',
      details: 'Treść i kontekst sprawy pozostają w panelu.',
      nextStep: 'Sprawdź zgłoszenie i odpowiedz w portalu.',
      cta: 'Otwórz zgłoszenia',
      path: '/admin/zgloszenia',
    });
}
export async function notifyCompanyStatus(
  db: NotificationDb,
  c: { id: string; name: string; verified: boolean },
  eventId: string,
) {
  const recipients = (
    await db.query<{ id: string }>("SELECT id FROM users WHERE role='owner' AND company_id=$1", [
      c.id,
    ])
  ).rows;
  for (const owner of recipients)
    await notifyStatus(db, {
      userId: owner.id,
      eventKey: `company.verification:${c.id}:${eventId}`,
      subject: c.verified
        ? 'Wypożyczalnia została zweryfikowana w VANLY'
        : 'Weryfikacja wypożyczalni wymaga wyjaśnienia',
      category: 'TWOJA WYPOŻYCZALNIA',
      intro: c.verified
        ? `Weryfikacja firmy ${c.name} jest zakończona.`
        : `Status weryfikacji firmy ${c.name} został zmieniony.`,
      details: c.verified
        ? 'Możesz publikować oferty pojazdów w portalu.'
        : 'Skontaktuj się z pomocą VANLY, aby ustalić dalsze kroki.',
      nextStep: 'Aktualny status i ustawienia firmy sprawdzisz w panelu.',
      cta: 'Otwórz panel',
      path: '/company',
    });
}
export function notifyCompanyOnboarding(db: NotificationDb, userId: string, companyId: string) {
  return notifyStatus(db, {
    userId,
    eventKey: `company.onboarding:${companyId}`,
    subject: 'Zapisaliśmy zgłoszenie wypożyczalni',
    category: 'TWOJA WYPOŻYCZALNIA',
    intro: 'Konto wypożyczalni zostało utworzone i czeka na weryfikację.',
    details: 'Uzupełnij dane firmy i przygotuj oferty pojazdów w panelu.',
    nextStep: 'Publikacja ofert jest dostępna po zakończeniu weryfikacji.',
    cta: 'Otwórz panel',
    path: '/company',
  });
}
export function notifyTeamMemberCreated(db: NotificationDb, id: string, companyName: string) {
  return notifyStatus(db, {
    userId: id,
    eventKey: `team.member_created:${id}`,
    subject: 'Masz dostęp do panelu wypożyczalni VANLY',
    category: 'TWOJE KONTO',
    intro: `Utworzono konto zespołu wypożyczalni ${companyName}.`,
    details:
      'Dane logowania uzgodnij z osobą, która utworzyła konto. Hasła nie przesyłamy w wiadomości.',
    nextStep:
      'Potwierdź adres e-mail osobnym linkiem. Po zalogowaniu możesz korzystać z panelu firmy.',
    cta: 'Otwórz panel',
    path: '/company',
    senderKind: 'no-reply',
  });
}
