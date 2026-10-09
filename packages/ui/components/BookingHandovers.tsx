'use client';
import React, { useId, useRef, useState } from 'react';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { Row, Field, CheckField, Notice } from './shared';

type HandoverKind = 'pickup' | 'return';
const stages: { kind: HandoverKind; label: string; Icon: typeof ArrowUpRight }[] = [
  { kind: 'pickup', label: 'Wydanie auta', Icon: ArrowUpRight },
  { kind: 'return', label: 'Odbiór auta', Icon: ArrowDownLeft },
];

export function BookingHandovers({
  booking,
  owner,
  busy,
  onSave,
  onConfirm,
}: {
  booking: Row;
  owner: boolean;
  busy: boolean;
  onSave: (data: Row) => void;
  onConfirm: (id: string) => void;
}) {
  const [active, setActive] = useState<HandoverKind>(() => {
    const unconfirmed = booking.handovers.find((h: Row) => !h.confirmed);
    if (!owner && unconfirmed) return unconfirmed.kind;
    return ['in_rental', 'completed'].includes(booking.status) ? 'return' : 'pickup';
  });
  const prefix = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <section className="panel handover-panel">
      <h2>Wydanie i odbiór auta</h2>
      <div className="handover-tabs no-print" role="tablist" aria-label="Etap przekazania auta">
        {stages.map(({ kind, label, Icon }, index) => (
          <button
            key={kind}
            type="button"
            role="tab"
            id={prefix + '-tab-' + kind}
            aria-controls={prefix + '-panel-' + kind}
            aria-selected={active === kind}
            tabIndex={active === kind ? 0 : -1}
            ref={(button) => {
              buttons.current[index] = button;
            }}
            onClick={() => setActive(kind)}
            onKeyDown={(event) => {
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 1
                    : ['ArrowLeft', 'ArrowRight'].includes(event.key)
                      ? 1 - index
                      : null;
              if (next === null) return;
              event.preventDefault();
              setActive(stages[next].kind);
              buttons.current[next]?.focus();
            }}
          >
            <Icon size={17} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      {stages.map(({ kind }) => {
        const pickup = kind === 'pickup';
        const records = booking.handovers.filter((h: Row) => h.kind === kind);
        const canSave =
          owner && records.length === 0 && booking.status === (pickup ? 'confirmed' : 'in_rental');
        return (
          <div
            key={kind}
            role="tabpanel"
            id={prefix + '-panel-' + kind}
            aria-labelledby={prefix + '-tab-' + kind}
            className="handover-tab-panel"
            hidden={active !== kind}
            tabIndex={0}
          >
            <p className="small muted handover-stage-description">
              {pickup
                ? 'Przed wyjazdem: stan auta przekazywanego podróżnikowi.'
                : 'Po powrocie: stan auta zwracanego do wypożyczalni.'}
            </p>
            {records.map((h: Row) => (
              <div className="handover-summary" key={h.id}>
                <div className="spread">
                  <h3>{pickup ? 'Protokół wydania auta' : 'Protokół odbioru auta'}</h3>
                  <span className="pill">
                    {h.confirmed ? 'Potwierdzony przez podróżnika' : 'Czeka na potwierdzenie'}
                  </span>
                </div>
                <p>
                  Przebieg: {h.mileage.toLocaleString('pl-PL')} km · Paliwo: {h.fuel}
                </p>
                <p>{h.notes || 'Brak dodatkowych uwag.'}</p>
                <p className="small muted">Sprawdzono wyposażenie, stan pojazdu i poziom paliwa.</p>
                {!owner && !h.confirmed && (
                  <button
                    className="btn secondary compact"
                    disabled={busy}
                    onClick={() => onConfirm(h.id)}
                  >
                    Potwierdzam treść protokołu
                  </button>
                )}
              </div>
            ))}
            {records.length === 0 && !canSave && (
              <Notice>
                {owner && !pickup && booking.status === 'confirmed'
                  ? 'Odbiór auta będzie dostępny po zapisaniu wydania auta podróżnikowi.'
                  : owner && pickup && ['pending', 'held'].includes(booking.status)
                    ? 'Wydanie auta będzie dostępne po potwierdzeniu rezerwacji.'
                    : pickup
                      ? 'Protokół wydania auta nie został jeszcze zapisany.'
                      : 'Protokół odbioru auta nie został jeszcze zapisany.'}
              </Notice>
            )}
            {canSave && (
              <form
                className="stack handover-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  onSave({
                    kind,
                    mileage: Number(form.get('mileage')),
                    fuel: form.get('fuel'),
                    notes: form.get('notes'),
                    checks: {
                      equipment: form.get('equipment') === 'on',
                      condition: form.get('condition') === 'on',
                      fuel: form.get('fuelCheck') === 'on',
                    },
                  });
                }}
              >
                <h3>{pickup ? 'Zapisz wydanie auta' : 'Zapisz odbiór auta'}</h3>
                <div className="form-grid">
                  <Field
                    label={pickup ? 'Przebieg przy wydaniu (km)' : 'Przebieg przy odbiorze (km)'}
                  >
                    <input
                      className="input"
                      name="mileage"
                      type="number"
                      min="0"
                      max="9999999"
                      required
                    />
                  </Field>
                  <Field
                    label={pickup ? 'Poziom paliwa przy wydaniu' : 'Poziom paliwa przy odbiorze'}
                  >
                    <select className="input" name="fuel">
                      {['Pełny', '3/4', '1/2', '1/4', 'Pusty'].map((fuel) => (
                        <option key={fuel}>{fuel}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field
                  label={
                    pickup ? 'Stan auta przy wydaniu i uwagi' : 'Stan auta przy odbiorze i uwagi'
                  }
                >
                  <textarea className="input" name="notes" maxLength={3000} />
                </Field>
                <div>
                  <CheckField label="Sprawdzono wyposażenie" name="equipment" required />
                  <CheckField label="Sprawdzono stan pojazdu" name="condition" required />
                  <CheckField label="Sprawdzono poziom paliwa" name="fuelCheck" required />
                </div>
                <p className="small muted">
                  {pickup
                    ? 'Zapisanie wydania rozpocznie wynajem.'
                    : 'Zapisanie odbioru zakończy wynajem.'}
                </p>
                <button className="btn primary" disabled={busy}>
                  {pickup ? 'Zapisz wydanie auta' : 'Zapisz odbiór auta'}
                </button>
              </form>
            )}
          </div>
        );
      })}
    </section>
  );
}
