import fs from 'node:fs/promises';
const engine = await fs.readFile('/Library/Application Support/Vanly/proxy-engine', 'utf8').catch(() => '');
if (engine.trim() !== 'nginx') {
  console.error('Podgląd portalu wymaga działającej wspólnej usługi Nginx.');
  process.exitCode = 1;
} else {
  console.log('Podgląd portalu obsługuje Nginx: https://vanly.me.local/ oraz http://127.0.0.1:8181/.');
}
