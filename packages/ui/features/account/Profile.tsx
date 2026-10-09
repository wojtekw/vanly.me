'use client';
import { useState, useEffect, useRef } from 'react';
import { Row, useApp, useData, Field, CheckField, Notice } from '../../components/shared';
import { EmailVerificationStatus } from '../auth/EmailVerificationStatus';

export function Profile() {
  const { user, api, act, session, brand } = useApp();
  const [drivers, setDrivers] = useState<Row[]>(user.profile.drivers || []);
  const newsletter = useData('/newsletter/status');
  const [marketingWanted, setMarketingWanted] = useState(false);
  const initializedPreference = useRef(false);
  useEffect(() => {
    if (!initializedPreference.current && newsletter.data?.status) {
      setMarketingWanted(['pending', 'confirmed'].includes(newsletter.data.status));
      initializedPreference.current = true;
    }
  }, [newsletter.data?.status]);
  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        act(async () => {
          const updated = await api('/auth/profile', 'PATCH', {
            name: f.get('name'),
            phone: f.get('phone'),
            drivers,
            marketing: marketingWanted,
          });
          setMarketingWanted(['pending', 'confirmed'].includes(updated.profile?.newsletterStatus));
          newsletter.reload();
          await session();
        }, 'Profil zapisany.');
      }}
    >
      <h2>Profil i kierowcy</h2>
      <div className="form-grid">
        <Field label="Imię i nazwisko">
          <input
            className="input"
            name="name"
            defaultValue={user.name}
            required
            minLength={2}
            maxLength={100}
          />
        </Field>
        <Field label="Telefon kontaktowy">
          <input
            className="input"
            name="phone"
            type="tel"
            defaultValue={user.profile.phone || ''}
            maxLength={30}
          />
        </Field>
      </div>
      <p className="small muted">E-mail konta: {user.email}</p>
      <EmailVerificationStatus />
      <hr className="divider" />
      <h3>Kto będzie prowadzić?</h3>
      <p className="small muted">
        Zapisz dane do ustalenia z wypożyczalnią. Ten formularz nie weryfikuje uprawnień i nie
        zbiera numerów dokumentów.
      </p>
      {drivers.map((d, i) => (
        <div className="driver-row" key={i}>
          <Field label="Imię i nazwisko">
            <input
              className="input"
              value={d.name}
              required
              minLength={2}
              onChange={(e) =>
                setDrivers(drivers.map((x, j) => (i === j ? { ...x, name: e.target.value } : x)))
              }
            />
          </Field>
          <Field label="Kraj uprawnień">
            <input
              className="input"
              value={d.country}
              onChange={(e) =>
                setDrivers(drivers.map((x, j) => (i === j ? { ...x, country: e.target.value } : x)))
              }
            />
          </Field>
          <Field label="Kategoria">
            <input
              className="input"
              value={d.licenseCategory}
              maxLength={10}
              onChange={(e) =>
                setDrivers(
                  drivers.map((x, j) => (i === j ? { ...x, licenseCategory: e.target.value } : x)),
                )
              }
            />
          </Field>
          <button
            className="btn danger compact"
            type="button"
            onClick={() => setDrivers(drivers.filter((_, j) => j !== i))}
          >
            Usuń
          </button>
        </div>
      ))}
      <button
        className="btn secondary"
        disabled={drivers.length >= 5}
        type="button"
        onClick={() =>
          setDrivers([...drivers, { name: '', country: 'Polska', licenseCategory: 'B' }])
        }
      >
        Dodaj kierowcę
      </button>
      <CheckField
        name="marketing"
        checked={marketingWanted}
        disabled={!newsletter.data?.status}
        onChange={(event) => setMarketingWanted(event.target.checked)}
        label={
          brand?.id === 'camperfolks'
            ? 'Chcę otrzymywać inspiracje podróżnicze.'
            : `Chcę otrzymywać inspiracje ${brand?.name || 'Vanly'}.`
        }
      />
      {newsletter.error ? (
        <Notice error>{newsletter.error}</Notice>
      ) : newsletter.data?.status === 'pending' ? (
        <Notice>Inspiracje czekają na potwierdzenie. Kliknij link w wiadomości, aby rozpocząć ich otrzymywanie.</Notice>
      ) : newsletter.data?.status === 'confirmed' ? (
        <p className="small muted">Otrzymywanie inspiracji jest potwierdzone. Możesz zrezygnować, odznaczając tę opcję.</p>
      ) : (
        <p className="small muted">Po włączeniu inspiracji poprosimy o potwierdzenie w osobnej wiadomości. Do tego czasu nie wysyłamy newslettera.</p>
      )}
      <button className="btn primary" disabled={!newsletter.data?.status}>Zapisz profil</button>
    </form>
  );
}
