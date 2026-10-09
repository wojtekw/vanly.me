import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

const webRequire = createRequire(new URL('../apps/frontoffice/package.json', import.meta.url));
const ts = webRequire('typescript');
const compiled = ts.transpileModule(
  fs.readFileSync(new URL('../apps/frontoffice/lib/request-id.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function generator(crypto) {
  const exports = {};
  runInNewContext(compiled, { exports, crypto });
  return exports.createRequestId;
}

test('uses native randomUUID with the Crypto receiver when available', () => {
  const id = webcrypto.randomUUID();
  const crypto = {
    randomUUID() {
      assert.equal(this, crypto);
      return id;
    },
    getRandomValues() {
      assert.fail('Native UUID generation should not use the fallback');
    },
  };
  assert.equal(generator(crypto)(), id);
});

test('HTTP fallback preserves random bytes and sets UUID v4 version and variant', () => {
  for (const [value, expected] of [
    [0, '00000000-0000-4000-8000-000000000000'],
    [255, 'ffffffff-ffff-4fff-bfff-ffffffffffff'],
  ]) {
    const crypto = {
      getRandomValues(bytes) {
        assert.equal(this, crypto);
        assert.equal(bytes.length, 16);
        return bytes.fill(value);
      },
    };
    assert.equal(generator(crypto)(), expected);
  }
});

test('without randomUUID, repeated requests receive distinct valid UUIDs', () => {
  const createRequestId = generator({
    getRandomValues: (bytes) => webcrypto.getRandomValues(bytes),
  });
  const ids = Array.from({ length: 1000 }, () => createRequestId());
  ids.forEach((id) => assert.match(id, uuidV4));
  assert.equal(new Set(ids).size, ids.length);
});

test('does not replace cryptographic randomness with weak identifiers', () => {
  for (const crypto of [undefined, {}])
    assert.throws(generator(crypto), /bezpiecznego generowania identyfikatorów/);
});
