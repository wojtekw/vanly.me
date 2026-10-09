'use client';
import { Row, useApp, useData, DataState, Field, Empty, Badge } from '../shared';

export function OwnerComments() {
  const { api, act } = useApp(),
    { data, error, reload } = useData('/owner/comments');
  return (
    <div className="stack">
      <h2>Pytania i opinie</h2>
      <DataState data={data} error={error}>
        {data?.length ? (
          data.map((c: Row) => (
            <form
              key={c.id}
              className="panel stack"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                act(async () => {
                  await api('/comments/' + c.id + '/reply', 'POST', { text: f.get('text') });
                  reload();
                }, 'Odpowiedź zapisana.');
              }}
            >
              <div className="spread">
                <h3>{c.vehicle_name}</h3>
                <Badge status={c.status} />
              </div>
              <p className="small muted">
                {c.author} ·{' '}
                {c.type === 'review' ? c.rating + ' / 5 — opinia po wynajmie' : 'Pytanie'}
              </p>
              <p>{c.text}</p>
              <Field label="Odpowiedź wypożyczalni">
                <textarea
                  className="input"
                  name="text"
                  defaultValue={c.reply || ''}
                  required
                  minLength={3}
                  maxLength={2000}
                />
              </Field>
              <button className="btn secondary">Zapisz odpowiedź</button>
            </form>
          ))
        ) : (
          <Empty
            title="Jeszcze bez pytań i opinii."
            text="Publiczne pytania z kart Twoich pojazdów trafią tutaj."
          />
        )}
      </DataState>
    </div>
  );
}
