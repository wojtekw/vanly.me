'use client';
import { Row, Badge } from '../shared';

export function OperatorSystem({
  d,
  mutation,
}: {
  d: Row;
  mutation: (path: string, body: Row, method?: string) => Promise<unknown>;
}) {
  return (
    <div className="stack">
      <div className="panel">
        <h2>Połączenia i usługi</h2>
        <div className="integration-options">
          <div>
            <strong>Płatności</strong>
            <p>
              Podróżujący rozliczają najem i kaucję z wypożyczalnią. Opłata za drugi i kolejny
              pojazd wynosi 200 zł jednorazowo; na UAT jest testowa.
            </p>
            <Badge status="Tryb testowy" />
          </div>
          <div>
            <strong>Powiadomienia</strong>
            <p>
              {d.integrations?.email === 'ses_outbox'
                ? 'Powiadomienia trafiają do kolejki wysyłki e-mail. Stan wysyłki sprawdzisz w zadaniach w tle.'
                : 'Powiadomienia są dostępne w skrzynce w serwisie. Nie wysyłamy wiadomości e-mail.'}
            </p>
            <Badge status={d.integrations?.email === 'ses_outbox' ? 'Amazon SES' : 'Lokalnie'} />
          </div>
          <div>
            <strong>Ubezpieczenia i winiety</strong>
            <p>Bez aktywnych dostawców i bez sprzedaży.</p>
            <Badge status="Niedostępne" />
          </div>
        </div>
      </div>
      <div className="panel">
        <h2>Zadania w tle</h2>
        {d.jobs.length ? (
          d.jobs.map((j: Row) => (
            <div className="equipment-row" key={j.id}>
              <div>
                <strong>
                  #{j.id} · {j.kind === 'mail' ? 'Powiadomienie' : j.kind}
                </strong>
                <p>{j.error || new Date(j.created_at).toLocaleString('pl-PL')}</p>
              </div>
              <Badge status={j.status} />
              {j.status === 'failed' && (
                <button
                  className="btn secondary compact"
                  onClick={() => mutation('/jobs/' + j.id + '/retry', {})}
                >
                  Ponów
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="muted">Brak zadań w kolejce.</p>
        )}
      </div>
    </div>
  );
}
