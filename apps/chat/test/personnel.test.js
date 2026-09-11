// Tests for lib/personnel.js against the fixture personnel/ in test/fixtures/repo.
// Never touches the repo's real personnel/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, readRoster, readPersonnel } from '../lib/personnel.js';

const FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'repo');

test('readRoster: valid dossiers parsed with all 8 fields, sorted by name', () => {
  const roster = readRoster(FIXTURE_ROOT);
  // Skipped: broken-mallory (no closing fence), bad-actor-eve (regex),
  // README.md (no leading fence). Kept: ada, bob, dora (departed stays —
  // status filtering is the API layer's job).
  assert.deepEqual(
    roster.map((r) => r.actorId),
    ['agent:eng-ada', 'agent:qa-bob', 'agent:analyst-dora']
  );
  assert.deepEqual(roster[0], {
    actorId: 'agent:eng-ada',
    name: 'Ada Fixture',
    title: 'Fixture Engineer',
    class: 'ic',
    reportsTo: 'agent:cto-owen',
    team: 'engineering',
    hired: '2026-08-30',
    status: 'active',
  });
});

test('readRoster: inline # comments and surrounding quotes are stripped', () => {
  const bob = readRoster(FIXTURE_ROOT).find((r) => r.actorId === 'agent:qa-bob');
  assert.deepEqual(bob, {
    actorId: 'agent:qa-bob', // was "agent:qa-bob" + trailing comment
    name: 'Bob Fixture', // was 'Bob Fixture'
    title: 'QA Engineer', // unquoted value + trailing comment
    class: 'ic',
    reportsTo: 'agent:cto-owen',
    team: 'quality',
    hired: '2026-08-30',
    status: 'active', // unquoted value + trailing comment
  });
});

test('readRoster: missing personnel/ directory yields [] (degradation contract)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-personnel-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(readRoster(dir), []);
});

test('parseFrontmatter: fences, junk lines, quotes, and comments', () => {
  assert.equal(parseFrontmatter('# just markdown\nkey: value'), null, 'no leading fence');
  assert.equal(parseFrontmatter('---\nkey: value\n'), null, 'no closing fence');
  const fm = parseFrontmatter(
    [
      '---',
      'actor_id: agent:x',
      '',
      '# full-line comment',
      'not a keyed line at all',
      'title: "Quoted # not a comment" # real comment',
      "name: 'Solo'",
      'url: http://example.test/x # colons in value survive first-colon split',
      '---',
      'body text: never parsed',
    ].join('\n')
  );
  assert.deepEqual(fm, {
    actor_id: 'agent:x',
    title: 'Quoted # not a comment',
    name: 'Solo',
    url: 'http://example.test/x',
  });
});

// --- AS-73: the fence predicate and the examined count ----------------------

/** Build a scratch <root>/personnel with the named files; returns the root. */
function plant(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'chat-personnel-as73-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'personnel'));
  for (const [file, text] of Object.entries(files)) {
    writeFileSync(join(root, 'personnel', file), text, 'utf8');
  }
  return root;
}

test('readPersonnel: fence whitespace and a BOM never hide a broken dossier', (t) => {
  // AS-73 F1. parseFrontmatter accepts a fence after trim() — a leading tab, a
  // trailing space, a BOM — so each of these IS a dossier to the parser. The
  // classifier has to agree, or the file is a person the gate never classified.
  const root = plant(t, {
    'bare.md': '---',
    'bom.md': '﻿---\nactor_id: agent:bom\nname: Bom\n',
    'lead.md': '\t---\nactor_id: agent:lead\nname: Lead\n',
    'ok-bom.md': '﻿---\nactor_id: agent:ok\nname: Ok\nstatus: active\n---\n',
    'README.md': '# not a dossier\n',
    'trail.md': '--- \nactor_id: agent:trail\nname: Trail\n',
  });
  const data = readPersonnel(root);
  assert.deepEqual(data.skipped, [
    { file: 'bare.md', reason: 'malformed_frontmatter' },
    { file: 'bom.md', reason: 'malformed_frontmatter' },
    { file: 'lead.md', reason: 'malformed_frontmatter' },
    { file: 'trail.md', reason: 'malformed_frontmatter' },
  ]);
  assert.deepEqual(
    data.roster.map((r) => r.actorId),
    ['agent:ok']
  );
  assert.equal(data.examined, 6);
});

test('readPersonnel: examined counts every .md file, dossier or not', (t) => {
  // AS-73 F2, isolated from F1: the broken dossier here carries a clean
  // `---\n` fence, so only the counter is under test.
  const root = plant(t, {
    'a.md': '---\nactor_id: agent:a\nname: A\nstatus: active\n---\n',
    'b.md': '---\nactor_id: agent:b\nname: B\nstatus: active\n---\n',
    'broken.md': '---\nactor_id: agent:c\nname: C\n',
    'README.md': '# not a dossier\n',
    'notes.txt': 'never examined — not a .md file\n',
  });
  const data = readPersonnel(root);
  assert.equal(data.examined, 4);
  assert.equal(data.roster.length, 2);
  assert.equal(data.skipped.length, 1);
  // The invariant every consumer can check: examined = parsed + skipped +
  // files with no leading fence (README.md alone, here).
  assert.equal(data.examined, data.roster.length + data.skipped.length + 1);

  const bare = mkdtempSync(join(tmpdir(), 'chat-personnel-as73-bare-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  assert.deepEqual(readPersonnel(bare), {
    roster: [],
    skipped: [],
    sources: [],
    examined: 0,
  });
});
