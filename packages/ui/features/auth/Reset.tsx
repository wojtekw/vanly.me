'use client';
import { useSearchParams } from 'next/navigation';
import { useApp, Field, Heading } from '../../components/shared';

export function Reset() {
  const { api, act, navigate } = useApp(),
    p = useSearchParams();
  return (
    <div className="container section reading">
      <Heading title="Ustaw nowe hasło." />
      <form
        className="panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          act(async () => {
            await api('/auth/reset', 'POST', {
              token: p.get('token'),
              password: form.get('password'),
            });
            navigate('/logowanie');
          }, 'Hasło zmienione. Zaloguj się ponownie.');
        }}
      >
        <Field label="Nowe hasło">
          <input
            className="input"
            type="password"
            name="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            required
          />
        </Field>
        <button className="btn primary">Zapisz nowe hasło</button>
      </form>
    </div>
  );
}
