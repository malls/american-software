// harness.test.js — the vacuity floor (AS-37, plan §8.3, §9.1).
//
// WHY THIS FILE EXISTS. This company has shipped or nearly shipped EIGHT
// vacuous passes — assertions that passed while the property they named was
// false: AS-17 (a public module missing from an allowlist 404'd at runtime
// while every unit test passed), AS-26 (a compose mount that made repo markdown
// unreachable in the only supported deployment), four in AS-29 cycle 1, one in
// AS-29's hardening, and one in AS-31's graph checker, which read the wrong JSON
// key, saw an empty graph, and passed three rules on nothing.
//
// Every one of those involved a green signal that meant nothing. This file
// makes green mean something, structurally, from day one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { APP_DIR, TEST_DIR } from './helpers/server.js';

// --- V1: the runner is proven able to fail ----------------------------------

test('V1: the runner can fail — ASC_SELFTEST_MUTATE=1 must turn this suite red', () => {
  // This is the whole instrument-validation move, and it is one line.
  //
  //   docker compose run --rm test                       -> exit 0
  //   docker compose run --rm -e ASC_SELFTEST_MUTATE=1 test -> exit 1
  //
  // Run in both directions it proves three things at once: the test service
  // really runs this suite, a failing assertion really produces a non-zero
  // exit, and compose really surfaces that exit code to the caller. Without it,
  // "the suite passed" is an unvalidated instrument reading — the same reason
  // the stack decision §5 validated `--network none` with both controls before
  // trusting it.
  assert.notEqual(
    process.env.ASC_SELFTEST_MUTATE,
    '1',
    'ASC_SELFTEST_MUTATE=1 is the deliberate mutation switch: this failure is the ' +
      'expected result and proves the runner can report red. An UNEXPECTED failure ' +
      'here means something is exporting ASC_SELFTEST_MUTATE=1 into a normal run.',
  );
});

// --- V2: cardinality before quantification ----------------------------------

/** Every *.test.js under test/, repo-relative, sorted. */
function discoverTestFiles(dir = TEST_DIR) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...discoverTestFiles(path));
    } else if (entry.endsWith('.test.js')) {
      found.push(relative(TEST_DIR, path));
    }
  }
  return found.sort();
}

// The committed literal. A test file that is renamed, deleted, or silently
// stops being a *.test.js turns this red — the AS-31 class, where a checker
// examined nothing and reported success. Adding a test file is a deliberate
// two-line change: the file, and this list.
const EXPECTED_TEST_FILES = [
  'assets.test.js',
  'auth.test.js',
  'clients.test.js',
  'config.test.js',
  'connect.test.js',
  'contracts.test.js',
  'db.test.js',
  'dependency-policy.test.js',
  'deploy-shape.test.js',
  'harness.test.js',
  'health.test.js',
  'invoices.test.js',
  'repositories.test.js',
  'stripe-client.test.js',
  'stripe-mock.test.js',
  'webhooks.test.js',
];

test('V2: the suite is exactly the files it is supposed to be', () => {
  const found = discoverTestFiles();
  // Cardinality FIRST, against a committed number — never `length > 0`.
  assert.equal(found.length, 16, `expected exactly 16 test files, found ${found.length}: ${found.join(', ')}`);
  assert.deepEqual(found, EXPECTED_TEST_FILES);
});

test('V2: this file is one of the discovered files, and the runner is running it', () => {
  // Closes the remaining gap in the check above: the disk enumeration proves
  // the files EXIST, and this proves the runner actually loaded at least this
  // one. Together with V1 (a failure here really exits 1), a green suite means
  // these sixteen files ran and could have failed.
  assert.ok(EXPECTED_TEST_FILES.includes('harness.test.js'));
  assert.ok(
    import.meta.url.endsWith('/test/harness.test.js'),
    `harness.test.js is running from an unexpected location: ${import.meta.url}`,
  );
});

// --- V4: every grep-based guard in this repo depends on this -----------------

/** Every .js file under `dir`, skipping the trees nobody owns. */
function discoverSourceFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'vendor') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) discoverSourceFiles(path, found);
    else if (entry.endsWith('.js')) found.push(path);
  }
  return found;
}

test('V4: no source file contains a control byte — grep must be able to read all of them', () => {
  // ADDED BY AS-40, after the same defect appeared TWICE in one task. A source
  // file carrying a literal NUL (an escape sequence that was written as the
  // character it denotes rather than as its two-character spelling) makes `file`
  // report "data" and makes grep treat it as BINARY: every match prints nothing
  // and the exit status is 1. Both AS-40 occurrences ran and passed their unit
  // tests perfectly — the damage was invisible except through grep.
  //
  // That matters far beyond one file. This repo's mutation discipline rests on
  // grep-based assert-applied steps, and the dependency-policy concept rows are
  // greppable by a reviewer working cold. A binary source file silently defeats
  // both: a `grep -c` that should read 1 reads nothing, and an unapplied
  // mutation becomes indistinguishable from a guard that did not fire.
  //
  // Tab, LF and CR are the only control bytes a source file may carry.
  const files = discoverSourceFiles(APP_DIR);
  assert.ok(files.length > 20, `the walk found only ${files.length} files — it is not examining the tree`);
  const offenders = [];
  for (const path of files) {
    const bytes = readFileSync(path);
    for (let i = 0; i < bytes.length; i += 1) {
      const b = bytes[i];
      if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
        offenders.push(`${relative(APP_DIR, path)}: byte 0x${b.toString(16).padStart(2, '0')} at offset ${i}`);
        break;
      }
      if (b === 0x7f) {
        offenders.push(`${relative(APP_DIR, path)}: DEL at offset ${i}`);
        break;
      }
    }
  }
  assert.deepEqual(offenders, [], `control bytes in source — write the ESCAPE SEQUENCE, not the character:\n${offenders.join('\n')}`);
});

// --- V3 is asserted where the subject lives ---------------------------------
// The container-is-the-subject guard is not a single test: assets.test.js
// fetches the real tokens.css out of the real image through the real serving
// path, and deploy-shape.test.js reads the real manifests as data. Both run
// inside the mountless, network-blocked `test` service, so they cannot be
// satisfied by a host-side fixture.
