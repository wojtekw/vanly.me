import fs from 'node:fs/promises';
import vm from 'node:vm';
const html = await fs.readFile('docs/prototype-v3.html', 'utf8');
const get = (name) =>
  vm.runInNewContext(
    html.match(new RegExp('const ' + name + '=(\\[[\\s\\S]*?\\]);'))[1],
    Object.create(null),
    { timeout: 1000 },
  );
const companies = [
  { id: 'baltic', name: 'Baltic Camp', city: 'Gdynia', lat: 54.5189, lng: 18.5305 },
  { id: 'slow-roads', name: 'Slow Roads', city: 'Warszawa', lat: 52.2297, lng: 21.0122 },
  { id: 'pod-gore', name: 'Pod Górę', city: 'Kraków', lat: 50.0647, lng: 19.945 },
  { id: 'lesna-baza', name: 'Leśna Baza', city: 'Poznań', lat: 52.4064, lng: 16.9252 },
  { id: 'weekend-dalej', name: 'Weekend Dalej', city: 'Wrocław', lat: 51.1079, lng: 17.0385 },
];
const vehicles = get('vehicles').map((v) => {
  const c = companies.find((c) => c.name === v.company);
  return { ...v, company_id: c.id, lat: c.lat, lng: c.lng };
});
const articles = get('articles').map((a) => ({
  ...a,
  body: a.body.map(([h, p]) => [
    h,
    p
      .replace('MVP przewiduje', 'Protokół pozwala zapisać')
      .replace(
        'cyfrowy zapis przebiegu, paliwa, wyposażenia i uszkodzeń',
        'przebieg, poziom paliwa, wyposażenie i uwagi o stanie pojazdu',
      )
      .replace(
        'W koncepcji Vanly dokumenty i historia komunikacji są częścią rezerwacji.',
        'Podsumowanie i protokoły znajdziesz w szczegółach rezerwacji.',
      ),
  ]),
}));
const coords = [
  [53.776, 21.573],
  [53.696, 17.717],
  [54.228, 18.091],
  [49.437, 20.476],
];
const camps = get('camps').map((c, i) => ({ ...c, lat: coords[i][0], lng: coords[i][1] }));
await fs.writeFile(
  'db/seed.json',
  JSON.stringify({ companies, vehicles, equipment: get('equipment'), articles, camps }, null, 2) +
    '\n',
);
const svg = html
  .match(/function caravan[\s\S]*?return `(.*?)`;/)[1]
  .replace('class="caravan-illustration ${cls}"', 'xmlns="http://www.w3.org/2000/svg"');
await fs.writeFile('apps/frontoffice/public/assets/caravan.svg', svg);
const accounts = JSON.parse(await fs.readFile('.local/accounts.json', 'utf8'));
await fs.writeFile(
  '.local/Konta-lokalne.md',
  '# Konta lokalne Vanly\n\nAdres: http://vanly.local\n\nDane służą wyłącznie tej lokalnej instalacji. Hasła nie są częścią kodu strony.\n\n| Konto | E-mail | Hasło |\n|---|---|---|\n' +
    accounts.map((a) => `| ${a.name} | ${a.email} | ${a.password} |`).join('\n') +
    '\n',
  { mode: 0o600 },
);
