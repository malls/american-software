// Unit tests for the pure sidebar-ordering + pin module (AS-18). No server,
// no DOM — the same file the browser imports is imported here directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { teamPrefix, rosterOrder, dmOrder, togglePin, sanitizePins } from '../public/dm-sort.js';

// --- teamPrefix --------------------------------------------------------------

test('dm-sort: teamPrefix — agent, human, system, multi-hyphen, no-hyphen', () => {
  assert.equal(teamPrefix('agent:developer-marcus'), 'developer');
  assert.equal(teamPrefix('agent:qa-priya'), 'qa');
  assert.equal(teamPrefix('agent:cto-owen'), 'cto');
  // Multi-hyphen local part: only the first segment is the role prefix.
  assert.equal(teamPrefix('agent:qa-automation-manager-alice'), 'qa');
  // No '-' in the local part: the whole local part is the prefix.
  assert.equal(teamPrefix('human:forrest'), 'forrest');
  assert.equal(teamPrefix('system:lattice'), 'lattice');
});

test('dm-sort: teamPrefix — malformed input degrades to empty string', () => {
  assert.equal(teamPrefix('no-colon-here'), '');
  assert.equal(teamPrefix('agent:'), '');
  assert.equal(teamPrefix(''), '');
  assert.equal(teamPrefix(null), '');
  assert.equal(teamPrefix(undefined), '');
  assert.equal(teamPrefix(42), '');
  // Leading '-' in the local part: empty prefix, still no throw.
  assert.equal(teamPrefix('agent:-weird'), '');
});

// --- rosterOrder ---------------------------------------------------------------

const R = (actorId, name) => ({ actorId, name });
const roster = [
  R('agent:qa-priya', 'Priya Raman'),
  R('agent:developer-marcus', 'Marcus Webb'),
  R('agent:ceo-carla', 'Carla Voss'),
  R('agent:developer-dana', 'Dana Ito'),
  R('agent:cto-owen', 'Owen Kessler'),
];

test('dm-sort: rosterOrder — no pins: prefix groups lexicographic, name tie-break', () => {
  assert.deepEqual(
    rosterOrder(roster, new Set()).map((r) => r.actorId),
    [
      'agent:ceo-carla',
      'agent:cto-owen',
      'agent:developer-dana', // Dana < Marcus inside the developer group
      'agent:developer-marcus',
      'agent:qa-priya',
    ]
  );
});

test('dm-sort: rosterOrder — pinned float to top, comparator-sorted within tiers', () => {
  const pins = new Set(['agent:qa-priya', 'agent:developer-marcus']);
  assert.deepEqual(
    rosterOrder(roster, pins).map((r) => r.actorId),
    [
      // Pinned tier, itself (prefix, name)-sorted — pin order never matters.
      'agent:developer-marcus',
      'agent:qa-priya',
      // Unpinned tier, same comparator.
      'agent:ceo-carla',
      'agent:cto-owen',
      'agent:developer-dana',
    ]
  );
  // Same pins as an array, reversed insertion order: identical result.
  assert.deepEqual(
    rosterOrder(roster, ['agent:developer-marcus', 'agent:qa-priya']),
    rosterOrder(roster, pins)
  );
});

test('dm-sort: rosterOrder — pins referencing absent ids are ignored', () => {
  const out = rosterOrder(roster, new Set(['agent:departed-zed', 'agent:ceo-carla']));
  assert.deepEqual(
    out.map((r) => r.actorId),
    [
      'agent:ceo-carla', // the only real pin
      'agent:cto-owen',
      'agent:developer-dana',
      'agent:developer-marcus',
      'agent:qa-priya',
    ]
  );
});

test('dm-sort: rosterOrder — never mutates input; junk degrades to []', () => {
  const copy = roster.slice();
  const out = rosterOrder(roster, new Set(['agent:qa-priya']));
  assert.notEqual(out, roster);
  assert.deepEqual(roster, copy, 'input array unchanged');
  assert.deepEqual(rosterOrder(null, new Set()), []);
  assert.deepEqual(rosterOrder(undefined, undefined), []);
  // Null/undefined pins mean "no pins", not a crash.
  assert.deepEqual(rosterOrder(roster, null).map((r) => r.actorId)[0], 'agent:ceo-carla');
});

// --- dmOrder -------------------------------------------------------------------

test('dm-sort: dmOrder — sorts by other-member prefix, then display name; no pins', () => {
  const dms = [
    { id: 1, other: 'human:forrest', name: 'Forrest' },
    { id: 2, other: 'agent:designer-zoe', name: 'Zoe Alvarez' },
    { id: 3, other: 'agent:designer-abe', name: 'Abe Cole' },
    { id: 4, other: 'agent:analyst-kim', name: 'Kim Park' },
  ];
  const out = dmOrder(dms, (d) => d.other, (d) => d.name);
  assert.deepEqual(out.map((d) => d.id), [4, 3, 2, 1]); // analyst < designer(Abe<Zoe) < forrest
  assert.notEqual(out, dms);
  assert.deepEqual(dms.map((d) => d.id), [1, 2, 3, 4], 'input array unchanged');
  assert.deepEqual(dmOrder(null, (d) => d.other, (d) => d.name), []);
});

test('dm-sort: dmOrder — stable over identical keys', () => {
  const dms = [
    { id: 10, other: 'agent:developer-a', name: 'Same Name' },
    { id: 11, other: 'agent:developer-b', name: 'Same Name' },
    { id: 12, other: 'agent:developer-c', name: 'Same Name' },
  ];
  assert.deepEqual(
    dmOrder(dms, (d) => d.other, (d) => d.name).map((d) => d.id),
    [10, 11, 12]
  );
});

// --- togglePin / sanitizePins ----------------------------------------------------

test('dm-sort: togglePin — add, remove, dedupe, input untouched', () => {
  assert.deepEqual(togglePin([], 'agent:qa-priya'), ['agent:qa-priya']);
  assert.deepEqual(togglePin(['agent:qa-priya'], 'agent:qa-priya'), []);
  // Dupes in the input collapse; toggling a duped id removes every copy.
  assert.deepEqual(togglePin(['a', 'a', 'b'], 'a'), ['b']);
  assert.deepEqual(togglePin(['a', 'a'], 'b'), ['a', 'b']);
  // Accepts a Set (what app.js holds in state) and returns a new array.
  assert.deepEqual(togglePin(new Set(['a']), 'b'), ['a', 'b']);
  const input = ['a'];
  togglePin(input, 'b');
  assert.deepEqual(input, ['a'], 'input never mutated');
  assert.deepEqual(togglePin(null, 'a'), ['a']);
});

test('dm-sort: sanitizePins — arrays keep string members deduped; junk -> []', () => {
  assert.deepEqual(sanitizePins(['a', 'b']), ['a', 'b']);
  assert.deepEqual(sanitizePins(['a', 'a', 'b']), ['a', 'b']);
  assert.deepEqual(sanitizePins(['a', 42, null, {}, 'b', undefined]), ['a', 'b']);
  assert.deepEqual(sanitizePins([]), []);
  assert.deepEqual(sanitizePins('not-an-array'), []);
  assert.deepEqual(sanitizePins({ 0: 'a' }), []);
  assert.deepEqual(sanitizePins(42), []);
  assert.deepEqual(sanitizePins(null), []);
  assert.deepEqual(sanitizePins(undefined), []);
});
