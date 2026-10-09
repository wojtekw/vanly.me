'use client';
import { Row, useApp, Field } from '../shared';

export function Team({ d, reload }: { d: Row; reload: () => void }) {
  const { api, act } = useApp();
  return (
    <div className="stack">
      <div className="panel">
        <h2>Razem ogarniacie wyjazdy.</h2>
        {d.team.map((u: Row) => (
          <div className="equipment-row" key={u.id}>
            <div>
              <strong>{u.name}</strong>
              <p>{u.email}</p>
            </div>
            <span className="pill">Obsługa firmy</span>
          </div>
        ))}
      </div>
      <form
        className="panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          const el = e.currentTarget,
            f = Object.fromEntries(new FormData(el));
          act(async () => {
            await api('/owner/team', 'POST', f);
            el.reset();
            reload();
          }, 'Konto pracownika utworzone.');
        }}
      >
        <h2>Dodaj osobę do zespołu</h2>
        <p className="small muted">
          Nowe konto ma dostęp do floty i rezerwacji tej firmy. W tej wersji wszystkie konta firmowe
          mają ten sam zakres uprawnień.
        </p>
        <div className="form-grid">
          <Field label="Imię i nazwisko">
            <input className="input" name="name" minLength={2} maxLength={100} required />
          </Field>
          <Field label="E-mail">
            <input className="input" name="email" type="email" required />
          </Field>
          <Field label="Hasło startowe">
            <input
              className="input"
              name="password"
              type="password"
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </Field>
        </div>
        <button className="btn primary">Utwórz konto pracownika</button>
      </form>
    </div>
  );
}
