// AS-115: public/tokens.css is a byte-identical copy of the design token file.
// The server serves public/ only, so the copy exists; this test is what keeps
// it honest. Edit docs/design/tokens/tokens.css, then copy — never the reverse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const served = path.join(here, '..', 'public', 'tokens.css');
const source = path.join(here, '..', '..', '..', 'docs', 'design', 'tokens', 'tokens.css');

test('T16 AC-16: public/tokens.css is byte-identical to docs/design/tokens/tokens.css', () => {
  const a = readFileSync(served);
  const b = readFileSync(source);
  assert.ok(b.length > 1000, `source token file is non-trivial (${b.length} bytes)`);
  assert.equal(a.length, b.length, 'same byte length');
  assert.ok(a.equals(b), 'byte-identical');
  // The AS-93 literal ban: nothing in the served token file is a host/port.
  const text = a.toString('utf8');
  for (const lit of ['8799', '8443', '127.0.0.1']) assert.ok(!text.includes(lit), `no ${lit} literal`);
});
