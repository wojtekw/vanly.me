'use client';
import React, { useEffect, useRef } from 'react';
import { isHeyvans } from '../../lib/brand';
import { hasCoordinates } from '../PickupLocation';
import { Row } from '../shared';
import 'leaflet/dist/leaflet.css';

export function MapView({ items, camps = false }: { items: Row[]; camps?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const hasLocations = items.some(hasCoordinates);
  useEffect(() => {
    let map: any,
      live = true;
    import('leaflet').then((L) => {
      if (!live || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false }).setView([52.1, 19.2], 6);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(map);
      const points: any[] = [];
      items.forEach((v) => {
        if (!hasCoordinates(v)) return;
        const marker = L.circleMarker([v.lat, v.lng], {
          radius: 10,
          color: '#fff',
          weight: 3,
          fillColor: isHeyvans ? '#141615' : '#143b39',
          fillOpacity: 1,
        }).addTo(map);
        const box = document.createElement('div'),
          strong = document.createElement('strong');
        strong.textContent = v.name;
        box.append(strong, document.createElement('br'));
        if (!camps) {
          const a = document.createElement('a');
          a.href = '/pojazd/' + encodeURIComponent(v.id);
          a.textContent = 'Zobacz pojazd →';
          box.append(a);
        } else box.append(document.createTextNode('Miejsce przykładowe'));
        marker.bindPopup(box);
        points.push([v.lat, v.lng]);
      });
      if (points.length) map.fitBounds(points, { padding: [50, 50], maxZoom: 10 });
    });
    return () => {
      live = false;
      map?.remove();
    };
  }, [items, camps]);
  return (
    <div>
      <div ref={el} className="live-map" aria-label="Mapa lokalizacji" />
      <p className="tiny muted map-note">
        {!hasLocations && 'Dla tych miejsc nie ma jeszcze lokalizacji na mapie. '}
        Mapa wymaga internetu. Wszystkie miejsca pozostają dostępne również na liście.
      </p>
    </div>
  );
}
