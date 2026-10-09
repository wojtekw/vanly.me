'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Heading, Notice, useApp } from './shared';

const actions = {
  email: {
    title: 'Potwierdź adres e-mail.',
    button: 'Potwierdź adres',
    endpoint: '/auth/verify-email',
    description:
      'Potwierdzenie pozwoli nam upewnić się, że wiadomości o Twoim koncie trafiają do Ciebie.',
  },
  newsletter: {
    title: 'Potwierdź zapis do newslettera.',
    button: 'Chcę otrzymywać newsletter',
    endpoint: '/newsletter/confirm',
    description:
      'Będziemy przesyłać Ci pomysły na wyjazdy i wiadomości VANLY. W każdej chwili możesz zrezygnować.',
  },
  unsubscribe: {
    title: 'Zrezygnuj z newslettera.',
    button: 'Rezygnuję z newslettera',
    endpoint: '/newsletter/unsubscribe',
    description:
      'Po rezygnacji nadal otrzymasz wiadomości potrzebne do obsługi konta i rezerwacji.',
  },
} as const;

export function EmailConfirmation({ kind }: { kind: keyof typeof actions }) {
  const { api, session } = useApp();
  const token = useSearchParams().get('token') || '';
  const valid = /^[a-f0-9]{64}$/.test(token);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ message: string; error?: boolean } | null>(null);
  const action = actions[kind];
  async function confirm() {
    if (!valid || pending || (result && !result.error)) return;
    setPending(true);
    try {
      const response = await api(action.endpoint, 'POST', { token });
      setResult({ message: response.message || 'Gotowe. Twoja decyzja została zapisana.' });
      if (kind === 'email') await session().catch(() => {});
      window.history.replaceState(null, '', window.location.pathname);
    } catch (error) {
      setResult({
        message: error instanceof Error ? error.message : 'Spróbuj ponownie za chwilę.',
        error: true,
      });
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="container section" style={{ maxWidth: 740 }}>
      <Heading eyebrow="VANLY / Twoje konto" title={action.title}>
        {action.description}
      </Heading>
      <div className="panel stack" style={{ marginTop: 28 }}>
        {!valid && !result && (
          <Notice error>
            Link jest niepełny lub nieprawidłowy. Otwórz pełny link z wiadomości e-mail.
          </Notice>
        )}
        {result && (
          <Notice error={result.error}>
            <span role="status">{result.message}</span>
          </Notice>
        )}
        {(!result || result.error) && (
          <button className="btn primary" disabled={!valid || pending} onClick={confirm}>
            {pending ? 'Zapisujemy…' : action.button}
          </button>
        )}
        <Link href="/konto" className="text-link">
          Przejdź do konta
        </Link>
      </div>
    </div>
  );
}
