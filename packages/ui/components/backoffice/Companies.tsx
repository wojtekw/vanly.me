'use client';
import { Row, Field, money } from '../shared';

export function OperatorCompanies({
  d,
  mutation,
}: {
  d: Row;
  mutation: (path: string, body: Row, method?: string) => Promise<unknown>;
}) {
  return (
    <div className="stack">
      <h2>Wypożyczalnie w Vanly</h2>
      {d.companies.map((c: Row) => (
        <form
          className="panel stack"
          key={c.id}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            mutation('/companies/' + c.id + '/verify', {
              verified: !c.verified,
              reason: f.get('reason'),
            });
          }}
        >
          <div className="spread">
            <div>
              <h3>{c.name}</h3>
              <p>{c.vehicle_count} pojazdów</p>
            </div>
            <span className={'pill ' + (c.verified ? 'good' : 'warn')}>
              {c.verified ? 'Zweryfikowana' : 'Czeka na weryfikację'}
            </span>
          </div>
          {c.listing_fees?.length > 0 && (
            <div>
              <h4>Opłaty za dodanie pojazdów</h4>
              {c.listing_fees.map((f: Row) => (
                <p className="small" key={f.vehicle_id}>
                  {f.vehicle_name} · {money(f.amount_minor)} ·{' '}
                  {f.status === 'pending'
                    ? 'Oczekuje na rozliczenie'
                    : f.status === 'paid_test'
                      ? 'Rozliczono testowo'
                      : 'Bez opłaty'}
                </p>
              ))}
            </div>
          )}
          <Field label="Uzasadnienie zmiany weryfikacji">
            <input className="input" name="reason" required minLength={5} maxLength={1000} />
          </Field>
          <button className={'btn ' + (c.verified ? 'secondary' : 'primary')}>
            {c.verified ? 'Wycofaj weryfikację' : 'Zweryfikuj firmę'}
          </button>
        </form>
      ))}
    </div>
  );
}
