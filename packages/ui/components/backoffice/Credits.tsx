'use client';
import { useRef, useState } from 'react';
import { Row, useApp, Field, Notice, money } from '../shared';
import { createRequestId } from '../../lib/request-id';

const names: Record<string, string> = {
  purchase_test: 'Zakup testowy',
  publication: 'Publikacja',
  renewal: 'Odnowienie',
  migration_grant: 'Miesiąc przejściowy',
};
export function CreditsWallet({ billing, reload }: { billing?: Row; reload: () => void }) {
  const { api, act } = useApp();
  const [count, setCount] = useState('1');
  const [scenario, setScenario] = useState('success');
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  const submitting = useRef(false);
  const credits = Number(count);
  const valid = Number.isInteger(credits) && credits >= 1 && credits <= 100000;
  return (
    <section className="panel stack" aria-labelledby="credits-heading">
      <div className="spread">
        <h3 id="credits-heading">Portfel Creditsów</h3>
        <strong>{billing?.wallet?.balance ?? 0} Creditsów</strong>
      </div>
      <p>
        1 Credit = {money(billing?.creditPriceMinor ?? 20000)}. Publikacja każdego pojazdu poza
        pierwszym kosztuje 1 Credit za miesiąc.
      </p>
      <p className="small muted">
        Portfel jest wspólny dla kamperów i przyczep. Odnawiamy oferty automatycznie. Brak Creditsów
        ukrywa płatne oferty; po zasileniu portfela wznowimy je na nowy miesiąc. Ręczne ukrycie
        zatrzymuje odnowienia.
      </p>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current || !valid || !billing?.testPaymentsEnabled) return;
          submitting.current = true;
          setBusy(true);
          key.current ??= createRequestId();
          try {
            await act(async () => {
              await api('/owner/credits/buy-test', 'POST', { credits, scenario }, key.current);
              key.current = null;
              reload();
            }, 'Portfel zasilony testowo.');
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field label="Liczba Creditsów">
            <input
              className="input"
              type="number"
              min="1"
              max="100000"
              step="1"
              required
              value={count}
              disabled={busy}
              onChange={(e) => {
                setCount(e.target.value);
                key.current = null;
              }}
            />
          </Field>
          {billing?.testPaymentsEnabled && (
            <Field label="Scenariusz płatności testowej">
              <select
                className="input"
                value={scenario}
                disabled={busy}
                onChange={(e) => {
                  setScenario(e.target.value);
                  key.current = null;
                }}
              >
                <option value="success">Udana płatność</option>
                <option value="failure">Odrzucona płatność</option>
              </select>
            </Field>
          )}
        </div>
        <div>
          <button
            className="btn primary"
            disabled={busy || !valid || !billing?.testPaymentsEnabled}
          >
            {busy
              ? 'Zasilamy…'
              : `Kup testowo ${valid ? credits : 0} Creditsów za ${money(valid ? credits * (billing?.creditPriceMinor ?? 20000) : 0)}`}
          </button>
        </div>
        <Notice>
          {billing?.testPaymentsEnabled
            ? 'Symulacja UAT — nie pobieramy prawdziwych pieniędzy.'
            : 'Zakup Creditsów jest obecnie niedostępny.'}
        </Notice>
      </form>
      {billing?.ledger?.length > 0 && (
        <details>
          <summary>Historia portfela (ostatnie 100 operacji)</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            {billing.ledger.map((entry: Row) => (
              <p className="small" key={entry.id}>
                {new Date(entry.created_at).toLocaleString('pl-PL')} ·{' '}
                {names[entry.kind] || entry.kind}
                {entry.vehicle_name ? ` · ${entry.vehicle_name}` : ''} ·{' '}
                {entry.credits > 0 ? '+' : ''}
                {entry.credits} Creditsów · saldo {entry.balance_after}
                {entry.amount_minor > 0 && <> · {money(entry.amount_minor)}</>}
                {entry.period_end && (
                  <> · do {new Date(entry.period_end).toLocaleString('pl-PL')}</>
                )}
              </p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
export function PublicationInfo({ publication }: { publication?: Row }) {
  if (!publication) return null;
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      <p className="small">
        {publication.exempt
          ? 'Pierwszy pojazd — publikacja bezpłatna.'
          : publication.valid_until
            ? `Opłacony okres do ${new Date(publication.valid_until).toLocaleString('pl-PL')}.`
            : 'Publikacja: 1 Credit za miesiąc.'}
      </p>
      {!publication.exempt && (
        <p className="small muted">
          {publication.paused_for_credits
            ? 'Oferta wstrzymana. Zasil portfel, aby wznowić publikację.'
            : publication.auto_renew
              ? 'Automatyczne odnowienie: 1 Credit z portfela.'
              : 'Odnowienia zatrzymane. Ponowna publikacja w opłaconym okresie jest bez dodatkowego Credita.'}
        </p>
      )}
    </div>
  );
}
