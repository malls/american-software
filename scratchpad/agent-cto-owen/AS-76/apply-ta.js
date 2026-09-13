// apply-ta.js — apply §4.5 T-A of docs/engineering/04-observability-posture.md
// (as corrected in review cycle 1) to a scratch copy of apps/invoicing, exactly
// as written, and let the suite say whether the instructions are executable.
//
//   node scratchpad/agent-cto-owen/AS-76/apply-ta.js <scratch-dir>
//
// Step 0: split the strippers + strippedText + SOURCE_EXT out of
//         test/dependency-policy.test.js into test/helpers/source-text.js and
//         test/source-text.test.js (the file is 1,198 lines against the
//         1,200-line cap it enforces on itself).
// Step 1: the four lib/telemetry modules + TWO SANCTIONED entries, literal 3 -> 5.
// Step 2: the source-count literal 63 -> 67 and the four sorted paths.
// Step 3: no new scanConcept row (asserted by omission).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const APP = process.argv[2];
if (!APP) throw new Error('usage: node apply-ta.js <scratch-dir>');
const TEST = join(APP, 'test/dependency-policy.test.js');

const src = readFileSync(TEST, 'utf8').split('\n');
const at = (n) => src[n - 1]; // 1-indexed, as the note cites them
const slice = (a, b) => src.slice(a - 1, b); // inclusive both ends

// --- assert the anchors the note names, before touching anything -------------
const anchors = [
  [137, '/** Strip comments so a scan cannot be fooled in either direction'],
  [147, 'function stripComments(source, { ejs = false } = {}) {'],
  [193, "test('the comment stripper works, in both directions', () => {"],
  [219, 'function stripHashComments(text, { trailing = false } = {}) {'],
  [229, "test('the manifest comment stripper works, in both directions', () => {"],
  [260, '});'],
  [278, 'const SOURCE_EXT = /\\.(js|mjs|cjs|ejs|css)$/;'],
  [345, 'function strippedText(path) {'],
  [352, '}'],
  [390, 'assert.equal(source.length, 63'],
  [432, "'lib/stripe/transport.js',"],
  [433, "'lib/vendor.js',"],
  [544, '];'], // end of SANCTIONED
  [584, 'assert.equal(SANCTIONED.length, 3'],
];
for (const [line, text] of anchors) {
  if (!at(line).includes(text)) throw new Error(`anchor ${line} moved: expected ${text}\n  got: ${at(line)}`);
}

// --- step 0: the split -------------------------------------------------------
const blockStrippers = slice(137, 261); // strippers + their two self-tests
const blockSourceExt = slice(276, 278); // SOURCE_EXT + its comment
const blockStripped = slice(344, 352); // strippedText + its comment

const testBodies = [];
const helperParts = [];
{
  // Split blockStrippers into helper code and the two self-tests.
  const text = blockStrippers.join('\n');
  const t1Start = text.indexOf("test('the comment stripper works");
  const t1End = text.indexOf('\n});', t1Start) + '\n});'.length;
  const t2Start = text.indexOf("test('the manifest comment stripper works");
  const t2End = text.indexOf('\n});', t2Start) + '\n});'.length;
  testBodies.push(text.slice(t1Start, t1End), text.slice(t2Start, t2End));
  helperParts.push(text.slice(0, t1Start).trimEnd(), text.slice(t1End, t2Start).trim());
}

const helper = [
  '// helpers/source-text.js — what a scanned file\'s text IS: the comment',
  '// strippers and the per-class dispatch that uses them. Split out of',
  '// dependency-policy.test.js (AS-77, T-A step 0), which was two lines under',
  '// the 1,200-line cap it enforces on itself. Mechanism only: every policy',
  '// literal — MANIFEST_NAME, UNSCANNED, SKIPPED_DIRS, the pattern rows and',
  '// every count — stays in dependency-policy.test.js.',
  "import { readFileSync } from 'node:fs';",
  "import { basename } from 'node:path';",
  "import { stripTrailingHashComment } from './hash-comment.js';",
  '',
  blockSourceExt.join('\n').replace('const SOURCE_EXT', 'export const SOURCE_EXT'),
  '',
  helperParts[0].replace('function stripComments', 'export function stripComments'),
  '',
  helperParts[1].replace('function stripHashComments', 'export function stripHashComments'),
  '',
  blockStripped.join('\n').replace('function strippedText', 'export function strippedText'),
  '',
].join('\n');

const helperTest = [
  '// source-text.test.js — the strippers prove themselves, in both directions.',
  '// Moved verbatim from dependency-policy.test.js with T-A step 0; a stripper',
  '// that silently returned \'\' would make every scan built on it vacuous.',
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { readFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "import { APP_DIR } from './helpers/server.js';",
  "import { stripComments, stripHashComments, strippedText } from './helpers/source-text.js';",
  '',
  testBodies[0],
  '',
  testBodies[1],
  '',
].join('\n');

mkdirSync(join(APP, 'test/helpers'), { recursive: true });
writeFileSync(join(APP, 'test/helpers/source-text.js'), helper);
writeFileSync(join(APP, 'test/source-text.test.js'), helperTest);

// Remove the three blocks from the guard file, high line numbers first.
const kept = src.slice();
kept.splice(344 - 1, 352 - 344 + 1);
kept.splice(276 - 1, 278 - 276 + 1);
kept.splice(137 - 1, 261 - 137 + 1);

// Swap the now-dead import for the helper import.
const importIdx = kept.findIndex((l) => l.includes("from './helpers/hash-comment.js'"));
if (importIdx === -1) throw new Error('hash-comment import not found');
kept[importIdx] = "import { SOURCE_EXT, strippedText } from './helpers/source-text.js';";
// `basename` was only used by strippedText.
const pathIdx = kept.findIndex((l) => l.startsWith("import { basename, join, relative }"));
if (pathIdx === -1) throw new Error('node:path import not found');
kept[pathIdx] = "import { join, relative } from 'node:path';";

let out = kept.join('\n');

// --- step 2: the source-count literal and the sorted array -------------------
const before = out;
out = out.replace(
  'assert.equal(source.length, 63, `expected 63 app source files',
  'assert.equal(source.length, 67, `expected 67 app source files',
);
if (out === before) throw new Error('source count literal not rewritten');
out = out.replace(
  "    'lib/stripe/transport.js',\n",
  "    'lib/stripe/transport.js',\n"
    + "    'lib/telemetry/client.js',\n"
    + "    'lib/telemetry/envelope.js',\n"
    + "    'lib/telemetry/schema.js',\n"
    + "    'lib/telemetry/transport.js',\n",
);

// --- step 1: two SANCTIONED entries, literal 3 -> 5 --------------------------
const entries = `  {
    file: 'lib/telemetry/transport.js',
    construct: 'fetch',
    count: 1,
    line: /^  const response = await fetch\\(url, init\\);$/,
    reason:
      'AS-77: the second sanctioned egress path (observability posture §3.3). Telemetry ' +
      'leaves from this line or not at all; a second hit anywhere is a third HTTP client.',
  },
  {
    file: 'lib/telemetry/client.js',
    construct: 'stripe transport import',
    count: 1,
    line: /^import \\{ sendEnvelope \\} from '\\.\\/transport\\.js';$/,
    reason:
      'AS-77: only the telemetry client may reach the telemetry transport. NOTE the ' +
      "construct name: the OUTBOUND_CLIENTS row 'stripe transport import' matches ANY " +
      'quoted path ending in transport.js, so it now guards both transports and its name ' +
      'is a misnomer. The name is left alone because the AS-38 falsification recipes quote it.',
  },
];`;
const endIdx = out.indexOf("    reason: 'AS-38: only the client may reach the transport");
const closeIdx = out.indexOf('\n];', endIdx) + 1;
out = out.slice(0, closeIdx) + entries + out.slice(closeIdx + '];'.length);
out = out.replace(
  'assert.equal(SANCTIONED.length, 3, `expected 3 SANCTIONED entries',
  'assert.equal(SANCTIONED.length, 5, `expected 5 SANCTIONED entries',
);
writeFileSync(TEST, out);

// --- the four telemetry modules (§3.3), stubs with the real egress shape -----
const tel = join(APP, 'lib/telemetry');
mkdirSync(tel, { recursive: true });
writeFileSync(join(tel, 'schema.js'), `// The allow-list, as data. Imports nothing, does no I/O.
export const ERROR_KEYS = ['type', 'code', 'stack', 'route', 'method', 'status'];
export const EVENT_KEYS = ['event', 'properties'];
`);
writeFileSync(join(tel, 'envelope.js'), `// Builds a wire envelope from schema-validated input. Pure.
import { ERROR_KEYS } from './schema.js';

export function buildErrorEnvelope(input) {
  const payload = {};
  for (const key of ERROR_KEYS) if (input[key] !== undefined) payload[key] = input[key];
  return JSON.stringify(payload);
}
`);
writeFileSync(join(tel, 'client.js'), `// The ONLY importer of transport.js. Sampling, the daily cap, drop-on-failure.
import { sendEnvelope } from './transport.js';
import { buildErrorEnvelope } from './envelope.js';

export function createTelemetryClient({ endpoint, key, dailyCap }) {
  let sentToday = 0;
  return {
    async recordError(input) {
      if (sentToday >= dailyCap) return false;
      sentToday += 1;
      return sendEnvelope({ endpoint, key, body: buildErrorEnvelope(input) });
    },
  };
}
`);
writeFileSync(join(tel, 'transport.js'), `// The ONE outbound call for telemetry. No retry; a drop is a drop.
const ALLOWED_HOST = 'ingest.example.invalid';

export async function sendEnvelope({ endpoint, key, body }) {
  const url = new URL(endpoint);
  if (url.hostname !== ALLOWED_HOST) throw new Error('telemetry host is not the pinned host');
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ingest-key': key },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(3000),
  };
  const response = await fetch(url, init);
  return response.ok;
}
`);

const lines = readFileSync(TEST, 'utf8').split('\n').length;
console.log(`dependency-policy.test.js: ${src.length} -> ${lines} lines (cap 1200)`);
console.log('helper: test/helpers/source-text.js, tests: test/source-text.test.js');
console.log('telemetry modules: schema.js envelope.js client.js transport.js');
