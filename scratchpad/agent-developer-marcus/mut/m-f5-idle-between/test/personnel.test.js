// Tests for lib/personnel.js against the fixture personnel/ in test/fixtures/repo.
// Never touches the repo's real personnel/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, readRoster } from '../lib/personnel.js';

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
