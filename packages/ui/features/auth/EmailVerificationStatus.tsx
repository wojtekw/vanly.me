'use client';
import { useState } from 'react';
import { useApp, Notice } from '../../components/shared';

export function EmailVerificationStatus() {
  const { user, api, act, notify } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Notice>
      {user.email_verified_at ? (
        <p className="small">Adres e-mail jest potwierdzony.</p>
      ) : (
        <div className="stack">
          <p className="small">Potwierdź adres e-mail, korzystając z linku w wiadomości od VANLY.</p>
          <button
            className="btn secondary compact"
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              act(async () => {
                try {
                  const response = await api('/auth/resend-verification', 'POST', {});
                  notify(response.message);
                } finally { setBusy(false); }
              });
            }}
          >
            {busy ? 'Przygotowujemy wiadomość…' : 'Wyślij nowy link potwierdzenia'}
          </button>
        </div>
      )}
    </Notice>
  );
}
