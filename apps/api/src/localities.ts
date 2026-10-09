import { readFileSync } from 'node:fs';
import path from 'node:path';

export type Locality = { id: string; name: string; label: string; lat: number; lng: number };
type SourceLocality = Locality & { population: number; feature: string };
export function normalizeLocality(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('pl')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}
const source = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../db/localities-pl.json'), 'utf8'),
) as SourceLocality[];
const indexed = source.map((row) => ({
  row,
  name: normalizeLocality(row.name),
  shortName: normalizeLocality(row.name.replace(/^Gmina /, '')),
  label: normalizeLocality(row.label),
}));
const suggestion = ({ id, name, label, lat, lng }: Locality): Locality => ({
  id,
  name,
  label,
  lat,
  lng,
});

export function searchLocalities(query: string): Locality[] {
  const needle = normalizeLocality(query);
  if (needle.length < 2) return [];
  return indexed
    .map((entry) => ({
      entry,
      rank:
        entry.name === needle
          ? 0
          : entry.name.startsWith(needle) || entry.shortName.startsWith(needle)
            ? 1
            : entry.label.split(/[ ·-]/).some((word) => word.startsWith(needle))
              ? 2
              : entry.label.includes(needle)
                ? 3
                : 4,
    }))
    .filter((match) => match.rank < 4)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.entry.row.population - a.entry.row.population ||
        a.entry.row.label.localeCompare(b.entry.row.label, 'pl'),
    )
    .slice(0, 12)
    .map(({ entry }) => suggestion(entry.row));
}

// Only a unique exact place can serve as a catalogue radius origin. Fleet
// coordinates come from a selected suggestion, not from guessing typed names.
export function resolveLocality(query: string): Locality | undefined {
  const needle = normalizeLocality(query);
  const matches = indexed.filter((entry) => entry.name === needle || entry.label === needle);
  return matches.length === 1 ? suggestion(matches[0].row) : undefined;
}
