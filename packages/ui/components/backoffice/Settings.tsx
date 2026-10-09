'use client';
import { Row, useApp, Field, Notice, money, date } from '../shared';

export function SettingsForm({ d, reload }: { d: Row; reload: () => void }) {
  const { api, act } = useApp();
  return (
    <div className="stack">
      <form
        className="panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          act(async () => {
            await api('/owner/settings', 'PATCH', {
              minDays: Number(f.get('minDays')),
              buffer: Number(f.get('buffer')),
              prep: Math.round(Number(f.get('prep')) * 100),
              open: f.get('open'),
              close: f.get('close'),
            });
            reload();
          }, 'Zasady zapisane. Dotychczasowe rezerwacje zachowują swoją wycenę.');
        }}
      >
        <h2>Twoja firma, Twoje zasady.</h2>
        <div className="form-grid">
          {[
            ['minDays', 'Minimalny wynajem (doby)', 1],
            ['buffer', 'Bufor po zwrocie (doby)', 1],
            ['prep', 'Opłata przygotowawcza (zł)', 100],
          ].map(([k, t, div]: any) => (
            <Field label={t} key={k}>
              <input
                className="input"
                name={k}
                type="number"
                step={div === 100 ? '0.01' : '1'}
                defaultValue={d.company.settings[k] / div}
                min={k === 'minDays' ? 1 : 0}
                max={k === 'buffer' ? 7 : k === 'minDays' ? 60 : undefined}
                required
              />
            </Field>
          ))}
          {[
            ['open', 'Odbiór i zwrot od'],
            ['close', 'Odbiór i zwrot do'],
          ].map(([k, t]) => (
            <Field label={t} key={k}>
              <input
                className="input"
                name={k}
                type="time"
                defaultValue={d.company.settings[k]}
                required
              />
            </Field>
          ))}
        </div>
        <Notice>
          Zmiany dotyczą nowych wycen. Ceny i warunki zapisanych rezerwacji pozostają w ich
          historii.
        </Notice>
        <button className="btn primary">Zapisz zasady</button>
      </form>
      <form
        className="panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          const el = e.currentTarget,
            f = new FormData(el);
          act(async () => {
            await api('/owner/seasons', 'POST', {
              name: f.get('name'),
              vehicleId: f.get('vehicleId') || null,
              start: f.get('start'),
              end: f.get('end'),
              rate: Math.round(Number(f.get('rate')) * 100),
            });
            el.reset();
            reload();
          }, 'Cena sezonowa zapisana.');
        }}
      >
        <h2>Ceny na sezon</h2>
        <p className="small muted">
          Stawka pojazdu ma pierwszeństwo przed stawką całej floty. Przy nakładaniu sezonów
          obowiązuje ten z późniejszą datą początku.
        </p>
        <div className="form-grid">
          <Field label="Nazwa sezonu">
            <input
              className="input"
              name="name"
              required
              minLength={2}
              maxLength={80}
              placeholder="Np. długi weekend"
            />
          </Field>
          <Field label="Zakres">
            <select className="input" name="vehicleId">
              <option value="">Cała flota</option>
              {d.vehicles.map((v: Row) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Od">
            <input className="input" type="date" name="start" required />
          </Field>
          <Field label="Do (bez tego dnia)">
            <input className="input" type="date" name="end" required />
          </Field>
          <Field label="Cena za dobę (zł)">
            <input className="input" type="number" name="rate" min="1" step="0.01" required />
          </Field>
        </div>
        <button className="btn secondary">Dodaj sezon</button>
        {d.seasons.map((s: Row) => (
          <div className="equipment-row" key={s.id}>
            <div>
              <strong>
                {s.name} · {money(s.rate)} / doba
              </strong>
              <p>
                {date(s.start_date)} — {date(s.end_date)} ·{' '}
                {d.vehicles.find((v: Row) => v.id === s.vehicle_id)?.name || 'Cała flota'}
              </p>
            </div>
            <button
              type="button"
              className="btn danger compact"
              onClick={() =>
                act(async () => {
                  await api('/owner/seasons/' + s.id, 'DELETE');
                  reload();
                }, 'Sezon usunięty.')
              }
            >
              Usuń
            </button>
          </div>
        ))}
      </form>
    </div>
  );
}
