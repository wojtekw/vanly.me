import fs from 'node:fs/promises';
import path from 'node:path';

const file = path.resolve(process.argv[2] || '.env.local');
const origin = 'https://heyvans.com.local';
const text = await fs.readFile(file, 'utf8');
const newline = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(/\r?\n/);
const entries = lines.flatMap((line, index) => /^\s*(?:export\s+)?APP_ADDITIONAL_ORIGINS\s*=/.test(line) ? [index] : []);
if (entries.length > 1) throw new Error('APP_ADDITIONAL_ORIGINS ma kilka definicji; zachowano plik konfiguracji.');
if (entries.length) {
  const index = entries[0];
  const [, prefix, raw] = lines[index].match(/^(\s*(?:export\s+)?APP_ADDITIONAL_ORIGINS\s*=)(.*)$/);
  const quoted = raw.match(/^(\s*)(["'])(.*?)\2(\s*(?:#.*)?)$/);
  const plain = raw.match(/^(\s*)(.*?)(\s+#.*)?$/);
  if (!quoted && /^[\s]*["']/.test(raw)) throw new Error('Nieprawidłowo zapisany APP_ADDITIONAL_ORIGINS; zachowano plik.');
  const value = quoted ? quoted[3] : plain[2].trim();
  const origins = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (origins.includes(origin)) {
    console.log('Dokładny origin HTTPS Heyvans jest już skonfigurowany.');
    process.exit(0);
  }
  const next = [...origins, origin].join(',');
  lines[index] = quoted
    ? `${prefix}${quoted[1]}${quoted[2]}${next}${quoted[2]}${quoted[4]}`
    : `${prefix}${plain[1]}${next}${plain[3] || ''}`;
} else {
  if (!lines.at(-1)) lines.pop();
  lines.push('APP_ADDITIONAL_ORIGINS=' + origin, '');
}
await fs.writeFile(file, lines.join(newline), { mode: 0o600 });
console.log('Dodano dokładny origin HTTPS Heyvans; pozostała konfiguracja zachowana.');
