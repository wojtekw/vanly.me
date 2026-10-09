import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const requireWeb = createRequire(new URL('../apps/frontoffice/package.json', import.meta.url));
const ts = requireWeb('typescript');
const React = requireWeb('react');
const { renderToStaticMarkup } = requireWeb('react-dom/server');
const compiled = ts.transpileModule(
  fs.readFileSync(new URL('../apps/frontoffice/components/ArticleText.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } },
).outputText;
const exports = {};
runInNewContext(compiled, { exports, require: requireWeb });
const render = text => new JSDOM(renderToStaticMarkup(React.createElement(exports.ArticleText, { text }))).window.document;

test('keeps paragraphs, checklist emphasis and clickable source attribution', () => {
  const doc = render('Pierwszy akapit.\n\nŹródło: [Urząd](https://example.com/zasady).\n\n**Przed wyjazdem:** sprawdź dokumenty.');
  assert.equal(doc.querySelectorAll('p').length, 3);
  assert.equal(doc.querySelector('a').href, 'https://example.com/zasady');
  assert.equal(doc.querySelector('a').textContent, 'Urząd');
  assert.match(doc.querySelector('a').rel, /noopener/);
  assert.equal(doc.querySelector('.guide-checklist strong').textContent, 'Przed wyjazdem:');
});

test('editorial text cannot inject HTML or executable links', () => {
  const doc = render('<img src=x onerror=alert(1)> [Kliknij](javascript:alert(1))\n\nZwykły tekst **ważny**.');
  assert.equal(doc.querySelector('img,script,a'), null);
  assert.match(doc.body.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(doc.querySelector('strong').textContent, 'ważny');
});
