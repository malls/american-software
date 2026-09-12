// AS-115: public/tokens.css is a byte-identical copy of the design token file.
// The server serves public/ only, so the copy exists; this test is what keeps
// it honest. Edit docs/design/tokens/tokens.css, copy it, and update the pin
// below — never the reverse. The pin is what makes the check run inside the
// compose image too, whose build context is apps/chat alone (no docs/ there);
// on the host both halves run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const served = path.join(here, '..', 'public', 'tokens.css');
const source = path.join(here, '..', '..', '..', 'docs', 'design', 'tokens', 'tokens.css');

// sha256 of docs/design/tokens/tokens.css at AS-115 (291 lines).
const SOURCE_SHA256 = 'a35909d4a6fa0f6f08c1893bc8dfeb3707cfd599503b1a6e37a94fd0475df634';
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

test('T16 AC-16: public/tokens.css is byte-identical to docs/design/tokens/tokens.css', () => {
  const a = readFileSync(served);
  assert.ok(a.length > 1000, `served token file is non-trivial (${a.length} bytes)`);
  assert.equal(sha(a), SOURCE_SHA256, 'public/tokens.css matches the pinned source digest');
  if (existsSync(source)) {
    const b = readFileSync(source);
    assert.equal(sha(b), SOURCE_SHA256, 'the pin matches the current docs/ source — update the pin with the copy');
    assert.equal(a.length, b.length, 'same byte length');
    assert.ok(a.equals(b), 'byte-identical');
  }
  // The AS-93 literal ban: nothing in the served token file is a host/port.
  const text = a.toString('utf8');
  for (const lit of ['8799', '8443', '127.0.0.1']) assert.ok(!text.includes(lit), `no ${lit} literal`);
});
