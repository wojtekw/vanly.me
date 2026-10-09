'use client';
import Link from 'next/link';
import { Row, Field, Empty, Badge } from '../shared';

export function OperatorReports({
  d,
  mutation,
}: {
  d: Row;
  mutation: (path: string, body: Row, method?: string) => Promise<unknown>;
}) {
  return (
    <div className="stack">
      <h2>Zgłoszenia podróżników</h2>
      {d.reports.length ? (
        d.reports.map((r: Row) => (
          <form
            key={r.id}
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              mutation('/reports/' + r.id + '/resolve', {
                status: f.get('status'),
                resolution: f.get('resolution'),
              });
            }}
          >
            <div className="spread">
              <h3>{r.subject}</h3>
              <Badge status={r.status} />
            </div>
            <p className="small muted">{r.author}</p>
            <p>{r.description}</p>
            {r.booking_id && (
              <Link className="text-link" href={'/operator/booking/' + r.booking_id}>
                Otwórz powiązaną rezerwację
              </Link>
            )}
            <Field label="Status zgłoszenia">
              <select
                className="input"
                name="status"
                defaultValue={r.status === 'open' ? 'in_progress' : r.status}
              >
                <option value="in_progress">W obsłudze</option>
                <option value="resolved">Rozwiązane</option>
              </select>
            </Field>
            <Field label="Odpowiedź i sposób rozwiązania">
              <textarea
                className="input"
                name="resolution"
                defaultValue={r.resolution || ''}
                required
                minLength={5}
                maxLength={3000}
              />
            </Field>
            <button className="btn primary">Zapisz odpowiedź</button>
          </form>
        ))
      ) : (
        <Empty title="Wszystko spokojnie." text="Nie ma jeszcze zgłoszeń do obsługi." />
      )}
    </div>
  );
}
