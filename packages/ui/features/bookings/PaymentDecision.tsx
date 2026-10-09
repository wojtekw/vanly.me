'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Row, Field } from '../../components/shared';

export function PaymentDecision({
  booking,
  busy,
  onDecision,
}: {
  booking: Row;
  busy: boolean;
  onDecision: (accept: boolean, instructions?: string) => Promise<void>;
}) {
  const direct = booking.snapshot.settlementMode === 'direct';
  const [instructions, setInstructions] = useState(booking.paymentInstructionsDefault || '');
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy || (direct && instructions.trim().length < 10)) return;
        onDecision(true, direct ? instructions.trim() : undefined);
      }}
    >
      {direct && (
        <>
          <Field label="Instrukcja płatności dla tej rezerwacji" full>
            <textarea
              className="input tall"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              required
              minLength={10}
              maxLength={4000}
              disabled={busy}
            />
          </Field>
          <p className="small muted">
            Po potwierdzeniu podróżujący otrzyma e-mail z tą instrukcją oraz podsumowaniem
            rezerwacji. Podaj sposób i termin zapłaty, potrzebne dane do przelewu i zasady
            rozliczenia kaucji.
          </p>
          <Link className="text-link" href="/company/settings">
            Ustaw domyślną instrukcję dla wypożyczalni
          </Link>
        </>
      )}
      <div className="inline">
        <button
          className="btn primary"
          disabled={busy || (direct && instructions.trim().length < 10)}
        >
          Potwierdź rezerwację
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={busy}
          onClick={() => onDecision(false)}
        >
          Odrzuć rezerwację
        </button>
      </div>
    </form>
  );
}
