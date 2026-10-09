'use client';
import { Row } from '../shared';

export function OperatorHistory({ d }: { d: Row }) {
  return (
    <div className="panel">
      <h2>Historia zmian</h2>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Kiedy</th>
              <th>Kto</th>
              <th>Czynność</th>
              <th>Identyfikator</th>
            </tr>
          </thead>
          <tbody>
            {d.audit.map((a: Row) => (
              <tr key={a.id}>
                <td>{new Date(a.created_at).toLocaleString('pl-PL')}</td>
                <td>{a.actor || 'System'}</td>
                <td>
                  <AuditLabel action={a.action} />
                </td>
                <td className="tiny break-word">{a.resource}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function AuditLabel({ action }: { action: string }) {
  const names: Row = {
    'booking.held': 'Blokada terminu',
    'booking.submitted': 'Rezerwacja bez wpłaty w VANLY',
    'listing.payment_test': 'Opłata za dodanie pojazdu — test',
    'booking.accepted': 'Akceptacja rezerwacji',
    'booking.rejected': 'Odrzucenie rezerwacji',
    'booking.cancelled': 'Anulowanie rezerwacji',
    'payment.local_test': 'Wpłata testowa',
    'payment.balance_test': 'Dopłata testowa',
    'payment.refund_test': 'Zwrot testowy',
    'vehicle.created': 'Dodanie pojazdu',
    'vehicle.updated': 'Zmiana oferty',
    'vehicle.photo': 'Zdjęcie pojazdu',
    'calendar.blocked': 'Blokada kalendarza',
    'calendar.unblocked': 'Usunięcie blokady',
    'stock.created': 'Dodanie wyposażenia',
    'stock.updated': 'Zmiana magazynu',
    'stock.archived': 'Archiwizacja wyposażenia',
    'stock.restored': 'Przywrócenie wyposażenia',
    'company.settings': 'Zmiana zasad firmy',
    'company.verified': 'Weryfikacja firmy',
    'company.onboarding': 'Rejestracja firmy',
    'comment.moderated': 'Moderacja treści',
    'comment.reply': 'Odpowiedź firmy',
    'review.created': 'Dodanie opinii',
    'question.created': 'Dodanie pytania',
    'report.created': 'Nowe zgłoszenie',
    'report.updated': 'Obsługa zgłoszenia',
    'article.updated': 'Zmiana artykułu',
    'handover.pickup': 'Protokół odbioru',
    'handover.return': 'Protokół zwrotu',
    'handover.confirmed': 'Potwierdzenie protokołu',
    'deposit.local_status': 'Testowy status kaucji',
    'booking.amendment_requested': 'Propozycja zmiany',
    'booking.amendment_accepted': 'Akceptacja zmiany',
    'booking.amendment_rejected': 'Odrzucenie zmiany',
    'team.member_created': 'Konto pracownika',
    'profile.updated': 'Zmiana profilu',
    'season.created': 'Nowy sezon cenowy',
    'season.deleted': 'Usunięcie sezonu',
    'job.retry': 'Ponowienie zadania',
  };
  return <>{names[action] || action}</>;
}
