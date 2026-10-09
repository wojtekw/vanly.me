'use client';
import { Row, Field, Notice, Empty, Badge } from '../shared';

export function OperatorModeration({
  d,
  mutation,
}: {
  d: Row;
  mutation: (path: string, body: Row, method?: string) => Promise<unknown>;
}) {
  return (
    <div className="stack">
      <h2>Moderacja pytań i opinii</h2>
      {d.comments.length ? (
        d.comments.map((c: Row) => (
          <form
            className="panel stack"
            key={c.id}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              mutation('/comments/' + c.id + '/moderate', {
                status: f.get('status'),
                reason: f.get('reason'),
              });
            }}
          >
            <div className="spread">
              <h3>{c.vehicle_name}</h3>
              <Badge status={c.status} />
            </div>
            <p className="small muted">
              {c.author} · {c.type === 'review' ? c.rating + ' / 5 — po wynajmie' : 'Pytanie'}
            </p>
            <p>{c.text}</p>
            {c.reply && <Notice>Odpowiedź firmy: {c.reply}</Notice>}
            <div className="form-grid">
              <Field label="Decyzja">
                <select
                  className="input"
                  name="status"
                  defaultValue={c.status === 'pending' ? 'published' : c.status}
                >
                  <option value="published">Opublikuj</option>
                  <option value="hidden">Ukryj</option>
                  <option value="rejected">Odrzuć</option>
                </select>
              </Field>
              <Field label="Uzasadnienie">
                <input
                  className="input"
                  name="reason"
                  required
                  minLength={5}
                  maxLength={1000}
                  defaultValue={c.reason || ''}
                />
              </Field>
            </div>
            <button className="btn primary">Zapisz decyzję</button>
          </form>
        ))
      ) : (
        <Empty
          title="Kolejka moderacji jest pusta."
          text="Pytania i opinie pojawią się po dodaniu ich przez podróżników."
        />
      )}
    </div>
  );
}
