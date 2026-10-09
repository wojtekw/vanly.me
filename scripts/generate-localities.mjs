import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceUrl = 'https://download.geonames.org/export/dump/PL.zip';
const archive = path.resolve(process.argv[2] || path.join(root, '.local/localities-source/PL.zip'));
await fs.mkdir(path.dirname(archive), { recursive: true });
let sourceLastModified = null;
if (!process.argv[2]) {
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error(`GeoNames download failed: ${response.status}`);
  sourceLastModified = response.headers.get('last-modified');
  await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()));
}
const source = execFileSync('unzip', ['-p', archive, 'PL.txt'], {
  maxBuffer: 50 * 1024 * 1024,
  encoding: 'utf8',
});
const rows = source
  .trim()
  .split('\n')
  .map((line) => line.split('\t'));
const provinces = {
  72: 'dolnośląskie',
  73: 'kujawsko-pomorskie',
  74: 'łódzkie',
  75: 'lubelskie',
  76: 'lubuskie',
  77: 'małopolskie',
  78: 'mazowieckie',
  79: 'opolskie',
  80: 'podkarpackie',
  81: 'podlaskie',
  82: 'pomorskie',
  83: 'śląskie',
  84: 'świętokrzyskie',
  85: 'warmińsko-mazurskie',
  86: 'wielkopolskie',
  87: 'zachodniopomorskie',
};
const adminKey = (r, level) => r.slice(10, 10 + level).join('.');
const counties = new Map(rows.filter((r) => r[7] === 'ADM2').map((r) => [adminKey(r, 2), r[1]]));
const municipalityName = (name) =>
  /^gmina\b/i.test(name) ? name.replace(/^gmina\b/i, 'Gmina') : `Gmina ${name}`;
const municipalities = new Map(
  rows.filter((r) => r[7] === 'ADM3').map((r) => [adminKey(r, 3), municipalityName(r[1])]),
);
const localities = rows
  .filter(
    (r) =>
      r[8] === 'PL' &&
      ((r[6] === 'P' && !['PPLQ', 'PPLH', 'PPLW'].includes(r[7])) || ['ADM3', 'ADM4'].includes(r[7])),
  )
  .map((r) => {
    const name = r[7] === 'ADM3' ? municipalityName(r[1]) : r[1];
    const county = counties.get(adminKey(r, 2));
    const municipality = municipalities.get(adminKey(r, 3));
    const context = [
      municipality && municipality !== name && municipality !== `Gmina ${name}`
        ? municipality.replace(/^Gmina /, 'gm. ')
        : null,
      county && county !== name ? county.replace(/^Powiat /, 'pow. ') : null,
      provinces[r[10]] ? `woj. ${provinces[r[10]]}` : null,
    ].filter(Boolean);
    return {
      id: `geonames:${r[0]}`,
      name,
      label: [name, ...context].join(' · '),
      lat: Number(r[4]),
      lng: Number(r[5]),
      population: Number(r[14]),
      feature: r[7],
    };
  })
  .filter(
    (r) =>
      r.name.length >= 2 && r.name.length <= 80 && Number.isFinite(r.lat) && Number.isFinite(r.lng),
  )
  .sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'pl') ||
      a.label.localeCompare(b.label, 'pl') ||
      a.id.localeCompare(b.id),
  );
// A few separate records share even their administrative context; retain them
// and distinguish their positions instead of silently selecting one location.
const labels = new Map();
for (const row of localities) labels.set(row.label, (labels.get(row.label) || 0) + 1);
for (const row of localities)
  if (labels.get(row.label) > 1) row.label += ` · ${row.lat}, ${row.lng}`;
if (localities.length < 45000) throw Error('GeoNames extract unexpectedly incomplete.');
const output = JSON.stringify(localities) + '\n';
await fs.writeFile(path.join(root, 'db/localities-pl.json'), output);
await fs.writeFile(
  path.join(root, 'db/localities-pl.source.json'),
  JSON.stringify(
    {
      source: 'GeoNames',
      sourceUrl,
      documentation: 'https://download.geonames.org/export/dump/readme.txt',
      attribution: 'Dane miejscowości: GeoNames.org (CC BY 4.0).',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      generatedAt: new Date().toISOString(),
      sourceLastModified,
      sourceSha256: crypto
        .createHash('sha256')
        .update(await fs.readFile(archive))
        .digest('hex'),
      outputSha256: crypto.createHash('sha256').update(output).digest('hex'),
      records: localities.length,
      features: Object.fromEntries(
        [...new Set(localities.map((r) => r.feature))]
          .sort()
          .map((feature) => [feature, localities.filter((r) => r.feature === feature).length]),
      ),
      changes:
      'Poland populated settlements and ADM3/ADM4; excludes abandoned/historical/destroyed settlements; Polish administrative labels and Gmina prefix; includes coordinates to disambiguate identical labels. Names longer than the application limit of 80 characters omitted.',
    },
    null,
    2,
  ) + '\n',
);
console.log(`Generated ${localities.length} Polish locality suggestions.`);
