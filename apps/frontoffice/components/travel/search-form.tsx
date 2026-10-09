'use client';
import React, { useState } from 'react';
import { addDays } from '../../lib/seo-dates';
import { isCamperfolks, isHeyvans } from '../../lib/brand';
import { LocalityInput } from '../PickupLocation';
import { Search as SearchIcon, MapPin, CalendarDays, Users } from 'lucide-react';
import { Row, useApp, isoDay } from '../shared';

export function SearchForm({
  initial = {},
  compact = false,
}: {
  initial?: Row;
  compact?: boolean;
}) {
  const { navigate, today } = useApp();
  const currentDay = today || isoDay();
  const [form, setForm] = useState({
    location: initial.location || '',
    start: initial.start || addDays(currentDay, 14),
    end: initial.end || addDays(currentDay, 21),
    guests: initial.guests || '2',
  });
  const set = (key: string, value: string) => setForm({ ...form, [key]: value });
  return (
    <form
      className={'search-box real-search ' + (compact ? 'compact-search' : '')}
      onSubmit={(e) => {
        e.preventDefault();
        navigate('/pojazdy?' + new URLSearchParams(form));
      }}
    >
      <div className="search-field">
        <MapPin size={23} />
        <span>
          <strong>Miejsce odbioru</strong>
          <LocalityInput
            ariaLabel="Miejsce odbioru"
            className=""
            value={form.location}
            onChange={(value) => set('location', value)}
            placeholder="Cała Polska"
          />
        </span>
      </div>
      <label className="search-field">
        <CalendarDays size={22} />
        <span>
          <strong>Odbiór</strong>
          <input
            aria-label="Data odbioru"
            type="date"
            min={currentDay}
            required
            value={form.start}
            onChange={(e) => set('start', e.target.value)}
          />
        </span>
      </label>
      <label className="search-field">
        <CalendarDays size={22} />
        <span>
          <strong>Zwrot</strong>
          <input
            aria-label="Data zwrotu"
            type="date"
            min={form.start}
            required
            value={form.end}
            onChange={(e) => set('end', e.target.value)}
          />
        </span>
      </label>
      <label className="search-field">
        <Users size={22} />
        <span>
          <strong>Podróżnicy</strong>
          <select
            aria-label="Liczba podróżników"
            value={form.guests}
            onChange={(e) => set('guests', e.target.value)}
          >
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'osoba' : n < 5 ? 'osoby' : 'osób'}
              </option>
            ))}
          </select>
        </span>
      </label>
      <button className="btn primary" type="submit">
        <SearchIcon size={19} />
        {isCamperfolks || isHeyvans ? 'Szukaj pojazdów' : 'Szukaj'}
      </button>
    </form>
  );
}
