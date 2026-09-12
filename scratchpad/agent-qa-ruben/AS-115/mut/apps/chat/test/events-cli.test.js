// test/events-cli.test.js — AS-100 producer CLI, spawned against a temp
// CHAT_EVENTS_PATH and the repo fixture root (the cli.test.js harness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EVENT_SHAPES } from '../lib/events.js';

const here = dirname(fileURLToPath(import.meta.url));
const BIN = join(here, '..', 'bin', 'events.js');
const FIXTURE_ROOT = join(here, 'fixtures', 'repo');

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'as100-cli-'));
  // Deliberately into a NOT-yet-existing events/ dir (AC-19).
  return { dir, path: join(dir, 'events', 'company.jsonl') };
}

function run(path, args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CHAT_EVENTS_PATH: path, CHAT_REPO_ROOT: FIXTURE_ROOT, NODE_OPTIONS: '--no-warnings' },
  });
}

const STAGE_ARGS = [
  'emit', 'stage_started', '--task', 'AS-7', '--stage', 'implement',
  '--employee', 'agent:developer-lena', '--actor', 'agent:cto-owen',
];

test('events-cli-creates-dir', () => {
  const { dir, path } = scratch();
  try {
    const res = run(path, STAGE_ARGS);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(existsSync(path), 'the first emit creates events/');
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    assert.equal(lines.length, 1);
    const ev = JSON.parse(lines[0]);
    assert.equal(ev.type, 'stage_started');
    assert.equal(ev.actor, 'agent:cto-owen');
    assert.equal(ev.data.actor, 'agent:developer-lena');
    assert.deepEqual(Object.keys(ev.data), [...EVENT_SHAPES.stage_started].sort());
    assert.equal(res.stdout.trim(), ev.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('events-cli-rejects-cut', () => {
  const { dir, path } = scratch();
  try {
    const bad = [
      ['emit', 'nope', '--actor', 'agent:cto-owen'],
      [...STAGE_ARGS.slice(0, -2)], // missing --actor
      ['emit', 'stage_started', '--task', 'AS-7', '--stage', 'implement', '--actor', 'agent:cto-owen'], // no --employee
      ['emit', 'stage_started', '--task', 'AS-7', '--stage', 'qa', '--employee', 'agent:developer-lena', '--actor', 'agent:cto-owen'],
      ['emit', 'stage_ended', '--task', 'AS-7', '--stage', 'implement', '--employee', 'agent:developer-lena', '--actor', 'agent:cto-owen', '--outcome', 'cut_by_timeout'],
      ['emit', 'subagent_exited', '--task', 'AS-7', '--stage', 'implement', '--employee', 'agent:developer-lena', '--actor', 'agent:cto-owen', '--exit', 'unclosed'],
      [...STAGE_ARGS, '--cycle', '0'],
      [...STAGE_ARGS.slice(0, -1), 'lena'], // bad actor id
    ];
    assert.equal(bad.length, 8, 'cardinality first: 8 bad invocations');
    let refused = 0;
    for (const args of bad) {
      const res = run(path, args);
      if (res.status === 1 && /usage:/.test(res.stderr)) refused += 1;
    }
    assert.equal(refused, 8, 'every bad invocation exits 1 with usage');
    assert.equal(existsSync(path), false, 'a refused emit writes zero bytes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('events-cli-unresolved-task-still-emits', () => {
  const { dir, path } = scratch();
  try {
    const ok = run(path, STAGE_ARGS);
    assert.equal(ok.status, 0, ok.stderr);
    const resolved = JSON.parse(readFileSync(path, 'utf8').trimEnd().split('\n')[0]);
    assert.ok(resolved.task_id, 'AS-7 resolves through the fixture ids.json');

    const missing = run(path, [...STAGE_ARGS.slice(0, 3), 'AS-999', ...STAGE_ARGS.slice(4)]);
    assert.equal(missing.status, 0, 'an unresolvable short id must not lose the record');
    assert.match(missing.stderr, /AS-999/);
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[1]).task_id, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('events-cli-open-and-tail', () => {
  const { dir, path } = scratch();
  try {
    const started = run(path, STAGE_ARGS).stdout.trim();
    const open = JSON.parse(run(path, ['open', '--json']).stdout);
    assert.deepEqual(open.stages.map((s) => [s.task, s.stage, s.actor]), [['AS-7', 'implement', 'agent:developer-lena']]);

    const ended = run(path, [
      'emit', 'stage_ended', '--task', 'AS-7', '--stage', 'implement',
      '--employee', 'agent:developer-lena', '--actor', 'agent:cto-owen', '--outcome', 'completed',
    ]);
    assert.equal(ended.status, 0, ended.stderr);
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines[1].data.startedId, started, 'the CLI back-references the open stage it closes');
    assert.equal(lines[1].data.closedBy, 'orchestrator');
    assert.equal(JSON.parse(run(path, ['open', '--json']).stdout).stages.length, 0);

    const tail = JSON.parse(run(path, ['tail', '--json', '--since', started]).stdout);
    assert.deepEqual(tail.events.map((e) => e.type), ['stage_ended'], '--since is exclusive');
    assert.equal(JSON.parse(run(path, ['tail', '--json', '--task', 'AS-1']).stdout).events.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
