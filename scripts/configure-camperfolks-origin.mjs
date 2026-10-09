import fs from 'node:fs/promises';
import path from 'node:path';

const file = path.resolve(process.argv[2] || '.env.local');
const origin = 'https://camperfolks.com.local';
const text = await fs.readFile(file, 'utf8');
const lines = text.split(/\r?\n/);
const index = lines.findIndex((line) => line.startsWith('APP_ADDITIONAL_ORIGINS='));
if (index >= 0) {
  const raw = lines[index].slice('APP_ADDITIONAL_ORIGINS='.length).trim();
  const unquoted = raw.replace(/^(["'])(.*)\1$/, '$2');
  const origins = unquoted.split(',').map((item) => item.trim()).filter(Boolean);
  if (origins.includes(origin)) {
    console.log('Dokładny origin HTTPS Camperfolks jest już skonfigurowany.');
    process.exit(0);
  }
  lines[index] = 'APP_ADDITIONAL_ORIGINS=' + [...origins, origin].join(',');
} else {
  if (!lines.at(-1)) lines.pop();
  lines.push('APP_ADDITIONAL_ORIGINS=' + origin, '');
}
await fs.writeFile(file, lines.join('\n'), { mode: 0o600 });
console.log('Dodano dokładny origin HTTPS Camperfolks; pozostała konfiguracja zachowana.');
