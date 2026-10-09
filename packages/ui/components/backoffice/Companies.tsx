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
          <div>
            <h4>Portfel: {c.credit_balance ?? 0} Creditsów</h4>
            <p className="small muted">
              Pierwszy pojazd bezpłatny. Pozostałe: 1 Credit za miesiąc; 1 Credit = 200 zł.
            </p>
            {c.credit_ledger?.length > 0 && (
              <details>
                <summary>Historia Creditsów</summary>
                {c.credit_ledger.map((entry: Row) => (
                  <p className="small" key={entry.id}>
                    {new Date(entry.created_at).toLocaleString('pl-PL')} ·{' '}
                    {entry.kind === 'purchase_test'
                      ? 'Zakup testowy'
                      : entry.kind === 'migration_grant'
                        ? 'Miesiąc przejściowy'
                        : entry.kind === 'renewal'
                          ? 'Odnowienie'
                          : 'Publikacja'}{' '}
                    · {entry.vehicle_name || 'Portfel'} · {entry.credits > 0 ? '+' : ''}
                    {entry.credits} · saldo {entry.balance_after}
                    {entry.amount_minor > 0 ? ` · ${money(entry.amount_minor)}` : ''}
                  </p>
                ))}
              </details>
            )}
          </div>
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
