'use client';
import { Row, useData, DataState, Notice } from '../../components/shared';
import { bookingDocumentUrl } from '../bookings/BookingDocuments';

export function LocalMail() {
  const { data, error, reload } = useData('/mail');
  return (
    <div className="panel">
      <div className="spread">
        <h2>Lokalna skrzynka</h2>
        <button className="btn secondary compact" onClick={reload}>
          Odśwież
        </button>
      </div>
      <Notice>
        Tutaj znajdziesz powiadomienia zapisane w lokalnej skrzynce. Nowy wpis może pojawić się po
        kilku sekundach. Jeśli wysyłka e-mail jest dostępna, wiadomości trafiają na adres konta.
      </Notice>
      <DataState data={data} error={error}>
        {data?.length ? (
          data.map((m: Row) => (
            <details className="mail-entry" key={m.id}>
              <summary>
                <strong>{m.subject}</strong>
                <span className="tiny muted">{new Date(m.created_at).toLocaleString('pl-PL')}</span>
              </summary>
              <p>{m.body}</p>
              {!!m.attachments?.length && (
                <div className="stack">
                  {m.attachments.map((attachment: Row) => (
                    <a
                      className="btn secondary compact"
                      key={attachment.documentId}
                      href={bookingDocumentUrl(attachment.bookingId, attachment.documentId)}
                      download={attachment.fileName}
                    >
                      Pobierz PDF · {attachment.fileName}
                    </a>
                  ))}
                </div>
              )}
            </details>
          ))
        ) : (
          <p className="muted">Skrzynka jest na razie pusta.</p>
        )}
      </DataState>
    </div>
  );
}
