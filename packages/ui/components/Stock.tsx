'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Archive, ArchiveRestore, ImagePlus, Package, Pencil, Plus, Search, X } from 'lucide-react';
import { Row, useApp, useData, DataState, Field, Notice, Empty, money, date, isoDay, types } from './shared';

const vehicleTypeLabels = Object.fromEntries(types.filter(([id]) => id !== 'all').map(([id, label]) => [id, label]));
const nextDay = (value: string, offset = 1) => {
  const day = new Date(value + 'T12:00:00');
  day.setDate(day.getDate() + offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};
const searchText = (value: string) => value.toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
type StockPhoto = { id: string; asset: string; file?: File };
const photoLimit = 6;

export function Stock({ vehicles = [] }: { vehicles?: Row[] }) {
  const { api } = useApp();
  const [range, setRange] = useState({ start: isoDay(), end: isoDay(7) });
  const [start, setStart] = useState(range.start), [end, setEnd] = useState(range.end);
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('active');
  const [editor, setEditor] = useState<Row | null | undefined>(undefined);
  const [archive, setArchive] = useState<Row | null>(null);
  const [busy, setBusy] = useState(''), [formError, setFormError] = useState('');
  const [message, setMessage] = useState(''), [actionError, setActionError] = useState('');
  const [dateError, setDateError] = useState('');
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([]);
  const [vehicleQuery, setVehicleQuery] = useState('');
  const [photos, setPhotos] = useState<StockPhoto[]>([]), [removedPhotos, setRemovedPhotos] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null), nameRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef(new Set<string>()), photoSequence = useRef(0);
  const savedItemId = useRef<string | undefined>(undefined);
  const returnFocus = useRef<HTMLElement | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const focusAfterChange = useRef(false);
  const { data, error, reload } = useData('/owner/stock?start=' + range.start + '&end=' + range.end);

  useEffect(() => {
    if (editor !== undefined) {
      const dialog = dialogRef.current;
      if (dialog && !dialog.open) dialog.showModal();
      nameRef.current?.focus({ preventScroll: true });
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = previousOverflow; };
    }
  }, [editor]);

  useEffect(() => () => { previewUrls.current.forEach((url) => URL.revokeObjectURL(url)); }, []);

  useEffect(() => {
    if (focusAfterChange.current && !busy && editor === undefined) {
      focusAfterChange.current = false;
      (returnFocus.current?.isConnected ? returnFocus.current : addRef.current)?.focus({ preventScroll: true });
    }
  }, [editor, busy]);

  const rows: Row[] = data || [];
  const active = rows.filter((s) => s.active !== false);
  const archived = rows.filter((s) => s.active === false);
  const unavailable = active.filter((s) => s.available <= 0);
  const visible = rows.filter((s) =>
    (filter === 'all' || (filter === 'archived' ? s.active === false : s.active !== false && (filter !== 'unavailable' || s.available <= 0))) &&
    searchText(s.name).includes(searchText(query.trim())),
  );
  const fleet = [...vehicles].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const matchingVehicles = fleet.filter((v) => searchText(v.name + ' ' + (v.city || '')).includes(searchText(vehicleQuery.trim())));

  function openEditor(item: Row | null, opener: HTMLButtonElement) {
    focusAfterChange.current = false;
    returnFocus.current = opener;
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
    savedItemId.current = item?.id;
    setPhotos(item?.photos || []);
    setRemovedPhotos([]);
    setPhotoError('');
    setEditor(item);
    setSelectedVehicleIds(item?.vehicle_ids || []);
    setVehicleQuery('');
    setArchive(null);
    setFormError('');
    setMessage('');
    setActionError('');
  }
  function closeEditor() {
    if (busy) return;
    dialogRef.current?.close();
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
    focusAfterChange.current = true;
    setEditor(undefined);
    setFormError('');
  }
  function selectPhotos(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    if (photos.length + files.length > photoLimit) return setPhotoError('Możesz dodać maksymalnie 6 zdjęć.');
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)))
      return setPhotoError('Wybierz zdjęcia w formacie JPG, PNG lub WebP.');
    if (files.some((file) => file.size > 10 * 1024 * 1024)) return setPhotoError('Jedno zdjęcie może mieć maksymalnie 10 MB.');
    setPhotoError('');
    const selected = files.map((file) => {
      const asset = URL.createObjectURL(file);
      previewUrls.current.add(asset);
      return { id: 'pending-' + ++photoSequence.current, asset, file };
    });
    setPhotos((current) => [...current, ...selected]);
  }
  function removePhoto(photo: StockPhoto) {
    if (photo.file) {
      URL.revokeObjectURL(photo.asset);
      previewUrls.current.delete(photo.asset);
    } else setRemovedPhotos((current) => [...current, photo.id]);
    setPhotos((current) => current.filter((p) => p.id !== photo.id));
    setPhotoError('');
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    if (name.length < 2) return setFormError('Podaj nazwę wyposażenia (co najmniej 2 znaki).');
    const body = {
      name,
      quantity: Number(form.get('quantity')),
      price: Math.round(Number(form.get('price')) * 100),
      unit: form.get('unit'),
      vehicleIds: selectedVehicleIds,
    };
    setBusy('save');
    setFormError('');
    let detailsSaved = false;
    try {
      const saved = await api(savedItemId.current ? '/owner/stock/' + savedItemId.current : '/owner/stock', savedItemId.current ? 'PATCH' : 'POST', body);
      savedItemId.current = saved.id;
      detailsSaved = true;
      for (const id of removedPhotos) {
        await api('/owner/stock/' + saved.id + '/photos/' + id, 'DELETE');
        setRemovedPhotos((current) => current.filter((photoId) => photoId !== id));
      }
      for (const photo of photos.filter((p) => p.file)) {
        const upload = new FormData();
        upload.append('file', photo.file!);
        const uploaded = await api('/owner/stock/' + saved.id + '/photos', 'POST', upload);
        setPhotos((current) => current.map((p) => p.id === photo.id ? uploaded : p));
        URL.revokeObjectURL(photo.asset);
        previewUrls.current.delete(photo.asset);
      }
      setMessage(editor ? 'Zmiany wyposażenia zapisane.' : selectedVehicleIds.length ? 'Wyposażenie dodane do magazynu i oferty wybranych pojazdów.' : 'Wyposażenie dodane do magazynu. Przypisz pojazdy, aby udostępnić je przy rezerwacji.');
      setFilter(editor?.active === false ? 'archived' : 'active');
      setQuery('');
      dialogRef.current?.close();
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.current.clear();
      focusAfterChange.current = true;
      returnFocus.current = addRef.current;
      setEditor(undefined);
      reload();
    } catch (e: any) {
      setFormError(detailsSaved
        ? 'Dane wyposażenia zapisane. Nie udało się zapisać wszystkich zmian zdjęć: ' + (e.message || 'Spróbuj ponownie.') + ' Ponowny zapis dokończy zmiany.'
        : e.message || 'Nie udało się zapisać wyposażenia. Spróbuj ponownie.');
      if (detailsSaved) reload();
    } finally {
      setBusy('');
    }
  }
  async function setActive(item: Row, value: boolean) {
    if (busy) return;
    setBusy(item.id);
    setActionError('');
    setMessage('');
    try {
      await api('/owner/stock/' + item.id, 'PATCH', { active: value });
      focusAfterChange.current = true;
      returnFocus.current = addRef.current;
      setArchive(null);
      setMessage(value ? item.vehicle_ids?.length ? 'Wyposażenie przywrócone do oferty.' : 'Wyposażenie przywrócone do magazynu. Przypisz pojazdy, aby udostępnić je przy rezerwacji.' : 'Wyposażenie przeniesione do archiwum.');
      reload();
    } catch (e: any) {
      setActionError(e.message || 'Nie udało się zmienić statusu wyposażenia.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="stack stock-page">
      <div className="stock-heading">
        <div>
          <p className="eyebrow">Wspólny magazyn floty</p>
          <h2>Wyposażenie</h2>
          <p className="muted">Dodawaj dodatki do wyjazdów, ustalaj ceny i pilnuj dostępnych sztuk.</p>
        </div>
        <button ref={addRef} className="btn primary" disabled={!!busy} onClick={(e) => openEditor(null, e.currentTarget)}>
          <Plus size={18} /> Dodaj wyposażenie
        </button>
      </div>
      {message && <div role="status"><Notice>{message}</Notice></div>}
      {actionError && <div role="alert"><Notice error>{actionError}</Notice></div>}

      {editor !== undefined && (
        <dialog ref={dialogRef} className="stock-dialog" aria-labelledby="stock-editor-title" onCancel={(e) => { e.preventDefault(); closeEditor(); }} onClick={(e) => {
          if (e.target !== e.currentTarget) return;
          const bounds = e.currentTarget.getBoundingClientRect();
          if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) closeEditor();
        }}>
        <form className="panel stack stock-editor" key={editor?.id || 'new'} onSubmit={save} aria-labelledby="stock-editor-title" aria-busy={busy === 'save'}>
          <div className="spread">
            <div>
              <p className="eyebrow">{editor ? 'Edycja pozycji' : 'Nowa pozycja'}</p>
              <h2 id="stock-editor-title">{editor ? 'Edytuj wyposażenie' : 'Dodaj wyposażenie do magazynu'}</h2>
            </div>
            <button type="button" className="icon-btn" aria-label="Zamknij formularz" disabled={!!busy} onClick={closeEditor}><X size={20} /></button>
          </div>
          {formError && <div role="alert"><Notice error>{formError}</Notice></div>}
          <div className="stock-editor-scroll">
          <fieldset className="stock-form-fields" disabled={!!busy}>
            <div className="form-grid">
              <Field label="Nazwa wyposażenia" full>
                <input ref={nameRef} className="input" name="name" required minLength={2} maxLength={100} defaultValue={editor?.name || ''} placeholder="Np. krzesło turystyczne, fotelik dziecięcy, grill" />
              </Field>
              <Field label="Liczba sztuk w magazynie">
                <input className="input" name="quantity" type="number" required min={editor?.minimum_quantity || 0} max={1000} step={1} defaultValue={editor?.quantity ?? 1} aria-describedby="stock-quantity-help" />
              </Field>
              <Field label="Cena za sztukę (zł)">
                <input className="input" name="price" type="number" required min={0} max={10000} step="0.01" defaultValue={(editor?.price ?? 0) / 100} />
              </Field>
              <Field label="Sposób naliczania ceny" full>
                <select className="input" name="unit" defaultValue={editor?.unit || 'trip'}>
                  <option value="trip">Jednorazowo za cały wyjazd</option>
                  <option value="day">Za każdą dobę wynajmu</option>
                </select>
              </Field>
            </div>
            <p id="stock-quantity-help" className="small muted">
              {editor?.minimum_quantity > 0
                ? `Zapisane rezerwacje wymagają co najmniej ${editor.minimum_quantity} szt. w magazynie, niezależnie od wybranego terminu.`
                : 'Wpisz łączny stan magazynu. Rezerwacje automatycznie pomniejszą dostępność. Stan 0 oznacza chwilowy brak wyposażenia.'}
            </p>
            <section className="stock-photo-section" aria-labelledby="stock-photos-title">
              <div className="spread"><h3 id="stock-photos-title">Zdjęcia wyposażenia</h3><span className="small muted">{photos.length} / {photoLimit}</span></div>
              <p className="small muted" id="stock-photos-help">Pokaż, jak wygląda dodatek. Do 6 zdjęć w formacie JPG, PNG lub WebP, maks. 10 MB każde.</p>
              {!!photos.length && <div className="stock-photo-grid">
                {photos.map((photo, index) => <figure className="stock-photo" key={photo.id}>
                  <img src={photo.asset} alt={'Zdjęcie wyposażenia ' + (index + 1)} />
                  <button type="button" className="icon-btn" aria-label={'Usuń zdjęcie ' + (index + 1)} onClick={() => removePhoto(photo)}><X size={17} /></button>
                  <figcaption>{photo.file ? 'Do zapisania' : 'Zapisane'}</figcaption>
                </figure>)}
              </div>}
              <input ref={photoInputRef} className="stock-photo-input" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Wybierz zdjęcia wyposażenia" aria-describedby="stock-photos-help" tabIndex={-1} onChange={selectPhotos} />
              <button type="button" className="btn secondary compact" disabled={photos.length >= photoLimit} onClick={() => photoInputRef.current?.click()}><ImagePlus size={17} /> Dodaj zdjęcia</button>
              {photoError && <p role="alert" className="stock-error small">{photoError}</p>}
              {!!(photos.some((p) => p.file) || removedPhotos.length) && <p className="small muted">Zmiany zdjęć zostaną zapisane razem z wyposażeniem.</p>}
            </section>
            <fieldset className="stock-types stock-vehicles">
              <legend>Udostępnij dla pojazdów</legend>
              {fleet.length ? <>
                <div className="stock-vehicle-tools">
                  <label className="stock-search"><Search size={16} /><input type="search" aria-label="Szukaj pojazdu" placeholder="Szukaj pojazdu…" value={vehicleQuery} onChange={(e) => setVehicleQuery(e.target.value)} /></label>
                  <div className="inline">
                    <button type="button" className="text-link" onClick={() => setSelectedVehicleIds(fleet.map((v) => v.id))}>Zaznacz całą flotę</button>
                    <button type="button" className="text-link" onClick={() => setSelectedVehicleIds([])}>Odznacz wszystkie</button>
                  </div>
                </div>
                <div className="stock-vehicle-options">
                  {matchingVehicles.map((vehicle) => <label className={'stock-vehicle-choice ' + (selectedVehicleIds.includes(vehicle.id) ? 'selected' : '')} key={vehicle.id}>
                    <input type="checkbox" name="vehicleIds" value={vehicle.id} checked={selectedVehicleIds.includes(vehicle.id)} onChange={(e) => {
                      const checked = e.target.checked;
                      setSelectedVehicleIds((ids) => checked ? ids.includes(vehicle.id) ? ids : [...ids, vehicle.id] : ids.filter((id) => id !== vehicle.id));
                    }} aria-label={vehicle.name} />
                    <span><strong>{vehicle.name}</strong><small>{vehicleTypeLabels[vehicle.type] || vehicle.type}{vehicle.city ? ' · ' + vehicle.city : ''}{vehicle.status === 'draft' ? ' · Szkic' : vehicle.status === 'hidden' ? ' · Ukryty' : ''}</small></span>
                  </label>)}
                  {!matchingVehicles.length && <p className="small muted">Nie znaleźliśmy pojazdu. Zmień wyszukiwanie.</p>}
                </div>
                <p className="small muted" role="status">Wybrano {selectedVehicleIds.length} z {fleet.length} pojazdów. Dodatek będzie dostępny tylko przy rezerwacji zaznaczonych pojazdów. Nowe pojazdy możesz przypisać później.</p>
              </> : <p className="small muted">W Twojej flocie nie ma jeszcze pojazdów. Możesz zapisać wyposażenie teraz i przypisać je po <Link className="text-link" href="/company/fleet">dodaniu pojazdu</Link>.</p>}
              {!selectedVehicleIds.length && fleet.length > 0 && <p className="small stock-unassigned-note">Bez zaznaczenia pojazdów pozycja zostanie w magazynie i nie pojawi się przy nowych rezerwacjach.</p>}
            </fieldset>
          </fieldset>
          </div>
          {editor && <p className="small muted">Zapisane rezerwacje zachowują swoją cenę. Zmiany dotyczą nowych wycen.</p>}
          <div className="inline stock-editor-actions">
            <button className="btn primary" disabled={!!busy}>{busy === 'save' ? 'Zapisujemy…' : editor ? 'Zapisz zmiany' : 'Dodaj do magazynu'}</button>
            <button type="button" className="btn secondary" disabled={!!busy} onClick={closeEditor}>Anuluj</button>
          </div>
        </form>
        </dialog>
      )}

      {data && <div className="metric-grid stock-metrics">
        {[
          ['Aktywne pozycje', active.length],
          ['Sztuki w magazynie', active.reduce((n, s) => n + s.quantity, 0)],
          ['Pozycje bez dostępności', unavailable.length],
          ['Pozycje w archiwum', archived.length],
        ].map(([label, count]) => <div className="metric" key={label}><p className="metric-label">{label}</p><strong>{count}</strong></div>)}
      </div>}

      <div className="panel stack stock-availability">
        <div className="spread"><h2>Sprawdź dostępność na wyjazd</h2><Package size={23} /></div>
        <form className="stock-dates" onSubmit={(e) => {
          e.preventDefault();
          if (!start || !end || end <= start) return setDateError('Koniec wyjazdu musi być późniejszy niż początek.');
          setDateError('');
          setRange({ start, end });
        }}>
          <Field label="Początek wyjazdu">
            <input className="input" type="date" required value={start} onChange={(e) => {
              const value = e.target.value;
              setStart(value);
              if (value && end <= value) setEnd(nextDay(value, 7));
            }} />
          </Field>
          <Field label="Koniec wyjazdu (dzień zwrotu)">
            <input className="input" type="date" required min={start ? nextDay(start) : undefined} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          <button className="btn secondary">Sprawdź dostępność</button>
        </form>
        {dateError && <p role="alert" className="stock-error small">{dateError}</p>}
        <p className="small muted">Dostępność poniżej: <strong>{date(range.start)} — {date(range.end)}</strong>. Pokazujemy najmniejszą liczbę wolnych sztuk w tym terminie. Dzień zwrotu jest już wolny.</p>
      </div>

      <div className="panel stock-list-panel">
        <div className="stock-list-tools">
          <div className="segmented stock-filters" aria-label="Widok magazynu">
            {[
              ['active', 'Aktywne', active.length],
              ['unavailable', 'Brak dostępności', unavailable.length],
              ['archived', 'Archiwum', archived.length],
              ['all', 'Wszystkie', rows.length],
            ].map(([id, label, count]) => <button key={id} className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => setFilter(String(id))}>{label} <span>{data ? count : '—'}</span></button>)}
          </div>
          <label className="stock-search"><Search size={17} /><input type="search" aria-label="Szukaj wyposażenia" placeholder="Szukaj wyposażenia…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        </div>
        <DataState data={data} error={error}>
          {data && !rows.length ? <Empty title="Zacznij od pierwszego dodatku." text="Dodaj krzesła, stół, fotelik lub inne wyposażenie. Ustal liczbę sztuk i cenę, a podróżnicy wybiorą dodatki przy rezerwacji.">
            <button className="btn primary" disabled={!!busy} onClick={(e) => openEditor(null, e.currentTarget)}><Plus size={18} /> Dodaj pierwsze wyposażenie</button>
          </Empty> : data && !visible.length ? <Empty title={filter === 'archived' && !query ? 'Archiwum jest puste.' : filter === 'unavailable' && !query ? 'Wyposażenie jest dostępne.' : 'Nie znaleźliśmy wyposażenia.'} text={filter === 'archived' && !query ? 'Wycofane dodatki znajdziesz tutaj. W każdej chwili możesz przywrócić je do oferty.' : 'Zmień wyszukiwanie lub przejdź do aktywnych pozycji.'}>
            <button className="btn secondary compact" onClick={() => { setQuery(''); setFilter('active'); }}>Pokaż aktywne wyposażenie</button>
          </Empty> : <>
            <div className="stock-list-labels" aria-hidden="true"><span>Wyposażenie</span><span>Stan i dostępność</span><span>Cena za sztukę</span><span>Zarządzaj</span></div>
            <div className="stock-items">
              {visible.map((item) => <article className="stock-item" key={item.id} aria-label={item.name}>
                <div className={'stock-item-name' + (item.photos?.length ? ' stock-has-photo' : '')}>
                  {!!item.photos?.length && <button className="stock-item-photo" disabled={!!busy} aria-label={'Zobacz zdjęcia: ' + item.name} onClick={(e) => openEditor(item, e.currentTarget)}><img src={item.photos[0].asset} alt={item.name} loading="lazy" />{item.photos.length > 1 && <span>+{item.photos.length - 1}</span>}</button>}
                  <div className="stock-item-caption">
                  <h3><button type="button" className="stock-item-title" aria-haspopup="dialog" disabled={!!busy} onClick={(e) => openEditor(item, e.currentTarget)}>{item.name}</button></h3>
                  <span className={'pill ' + (item.active === false ? '' : !item.vehicle_ids?.length || item.available <= 0 ? 'warn' : 'good')}>{item.active === false ? 'W archiwum' : !item.vehicle_ids?.length ? 'Nieprzypisane' : item.quantity === 0 ? 'Brak na stanie' : item.available <= 0 ? 'Zarezerwowane' : 'W ofercie'}</span>
                  <p className="small muted">{item.vehicle_ids?.length ? fleet.filter((v) => item.vehicle_ids.includes(v.id)).map((v) => v.name).join(' · ') : 'Brak przypisanych pojazdów'}</p>
                  </div>
                </div>
                <div className="stock-item-quantity">
                  <strong>{item.available} <small>dostępnych</small></strong>
                  <p className="small muted">{item.reserved} zajętych · {item.quantity} na stanie</p>
                  {item.active === false && <p className="tiny muted">Poza nowymi rezerwacjami</p>}
                </div>
                <div className="stock-item-price"><strong>{money(item.price)}</strong><p className="small muted">{item.unit === 'day' ? 'za dobę' : 'za cały wyjazd'}</p></div>
                <div className="stock-item-actions">
                  <button className="btn secondary compact" disabled={!!busy} aria-label={'Edytuj ' + item.name} onClick={(e) => openEditor(item, e.currentTarget)}><Pencil size={14} /> Edytuj</button>
                  <button className="stock-archive-action" disabled={!!busy} aria-label={(item.active === false ? 'Przywróć ' : 'Archiwizuj ') + item.name} onClick={() => {
                    if (item.active === false) void setActive(item, true);
                    else { setArchive(item); setEditor(undefined); setActionError(''); setMessage(''); }
                  }}>{item.active === false ? <ArchiveRestore size={14} /> : <Archive size={14} />}{busy === item.id ? 'Zapisujemy…' : item.active === false ? 'Przywróć' : 'Archiwizuj'}</button>
                </div>
                {archive?.id === item.id && <div className="stock-archive-confirm" role="group" aria-label={'Archiwizacja ' + item.name}>
                  <div><strong>Wycofać „{item.name}” z oferty?</strong><p className="small muted">Dodatek przestanie być dostępny dla nowych rezerwacji. Zapisane wyjazdy zachowają wyposażenie. Możesz je później przywrócić.</p></div>
                  <div className="inline"><button className="btn secondary compact" disabled={!!busy} onClick={() => void setActive(item, false)}>Archiwizuj wyposażenie</button><button className="text-link" disabled={!!busy} onClick={() => setArchive(null)}>Anuluj</button></div>
                </div>}
              </article>)}
            </div>
            {data && <p className="small muted stock-list-note" role="status">{visible.length} z {rows.length} pozycji w magazynie. Zaznaczone pojazdy korzystają ze wspólnej liczby sztuk danego dodatku.</p>}
          </>}
        </DataState>
        {error && <button className="btn secondary compact" onClick={reload}>Spróbuj ponownie</button>}
      </div>
    </div>
  );
}
