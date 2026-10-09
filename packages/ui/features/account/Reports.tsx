'use client';
import { Row, useApp, useData, DataState, Field, Notice, Badge } from '../../components/shared';

export function Reports() {
  const { api, act } = useApp(),
    { data, error, reload } = useData('/reports');
  return (
    <div className="stack">
      <form
        className="panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          const el = e.currentTarget,
            d = Object.fromEntries(new FormData(el));
          act(async () => {
            await api('/reports', 'POST', d);
            el.reset();
            reload();
          }, 'Zgłoszenie zapisano. Operator zobaczy je w swoim panelu.');
        }}
      >
        <h2>Co możemy wyjaśnić?</h2>
        <Field label="Temat">
          <input className="input" name="subject" required minLength={3} maxLength={120} />
        </Field>
        <Field label="Opis sprawy">
          <textarea className="input" name="description" required minLength={10} maxLength={3000} />
        </Field>
        <button className="btn primary">Wyślij zgłoszenie</button>
      </form>
      <DataState data={data} error={error}>
        {data?.map((r: Row) => (
          <div className="panel" key={r.id}>
            <div className="spread">
              <h3>{r.subject}</h3>
              <Badge status={r.status} />
            </div>
            <p>{r.description}</p>
            {r.resolution && <Notice>{r.resolution}</Notice>}
          </div>
        ))}
      </DataState>
    </div>
  );
}
