'use client';
import React, { useEffect, useId, useRef, useState } from 'react';
import { Row, useApp } from './shared';

export type Locality = {
  id: string;
  name: string;
  label: string;
  lat: number | null;
  lng: number | null;
};

export function hasCoordinates(place: { lat?: unknown; lng?: unknown }) {
  return (
    typeof place.lat === 'number' &&
    typeof place.lng === 'number' &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lng)
  );
}

export function pickupAddress(place: Row) {
  return [place.city, [place.street, place.house_number].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
}

export function LocalityInput({
  value,
  onChange,
  ariaLabel = 'Miejscowość lub gmina',
  id,
  name,
  required = false,
  className = 'input',
  placeholder = 'Wpisz miejscowość lub gminę',
  describedBy,
}: {
  value: string;
  onChange: (value: string, locality?: Locality) => void;
  ariaLabel?: string;
  id?: string;
  name?: string;
  required?: boolean;
  className?: string;
  placeholder?: string;
  describedBy?: string;
}) {
  const { api } = useApp();
  const generatedId = useId();
  const inputId = id || 'locality-' + generatedId;
  const listId = inputId + '-options';
  const requestVersion = useRef(0);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Locality[]>([]);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('ready');
  const query = value.trim();
  const showPopup = open && query.length >= 2;

  useEffect(() => {
    const version = ++requestVersion.current;
    setOptions([]);
    setActive(-1);
    if (!open || query.length < 2) {
      setStatus('ready');
      return;
    }
    setStatus('loading');
    const timer = setTimeout(() => {
      api('/localities?q=' + encodeURIComponent(query))
        .then((rows: Locality[]) => {
          if (requestVersion.current !== version) return;
          setOptions(rows);
          setStatus('ready');
        })
        .catch(() => {
          if (requestVersion.current === version) setStatus('error');
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      if (requestVersion.current === version) requestVersion.current++;
    };
  }, [value, open, api]);

  function close() {
    requestVersion.current++;
    setOpen(false);
    setActive(-1);
  }

  function choose(locality: Locality) {
    close();
    onChange(locality.name, locality);
  }

  return (
    <div className="locality-combobox">
      <input
        id={inputId}
        name={name}
        className={className}
        value={value}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showPopup}
        aria-controls={showPopup ? listId : undefined}
        aria-activedescendant={showPopup && active >= 0 ? listId + '-' + active : undefined}
        autoComplete="off"
        required={required}
        minLength={required ? 2 : undefined}
        maxLength={80}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onChange={(e) => {
          requestVersion.current++;
          setOptions([]);
          setActive(-1);
          setOpen(true);
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setOpen(true);
            if (options.length) {
              setActive((index) =>
                e.key === 'ArrowDown'
                  ? (index + 1) % options.length
                  : (index <= 0 ? options.length : index) - 1,
              );
            }
          } else if (e.key === 'Enter' && showPopup && active >= 0 && options[active]) {
            e.preventDefault();
            choose(options[active]);
          }
        }}
      />
      {showPopup && (
        <div className="locality-popup">
          <ul id={listId} role="listbox" aria-label="Proponowane miejscowości i gminy">
            {options.map((locality, index) => (
              <li
                key={locality.id}
                id={listId + '-' + index}
                role="option"
                aria-selected={active === index}
                className={active === index ? 'active' : ''}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(locality)}
              >
                {locality.label}
              </li>
            ))}
          </ul>
          {!options.length && (
            <p className="locality-status" role="status">
              {status === 'loading'
                ? 'Szukamy miejscowości…'
                : status === 'error'
                  ? 'Podpowiedzi są teraz niedostępne. Możesz wpisać własną miejscowość.'
                  : 'Brak podpowiedzi. Możesz pozostawić wpisaną miejscowość lub gminę.'}
            </p>
          )}
          <p className="locality-status">
            Dane miejscowości: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>
          </p>
        </div>
      )}
    </div>
  );
}
