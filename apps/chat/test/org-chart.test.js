// AS-33: the org validator and tree builder (public/org-chart.js) plus the
// host-runnable gate (bin/check-org.js).
//
// The hazard this file exists for: a validator run against a valid roster
// reports clean whether or not it can detect anything. So every rule gets a
// literal that VIOLATES it and an assertion on the whole violation array —
// never a .some(), never a "no violations" case standing in for coverage.
// `org: a clean roster yields zero violations` is deliberately the LAST
// validator case in this file: on its own it proves nothing.
//
// Rules are proven against inline roster literals, not against personnel/.
// The repo's real roster is never read here; the container that runs this
// suite mounts nothing (compose.yaml, `test` service), and that mountlessness
// is itself the proof the suite touches no real state. `node
// bin/check-org.js` is what checks the real roster.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOARD_ROOT,
  BOARD_NODE,
  ORG_RULES,
  VALID_CLASSES,
  VALID_STATUSES,
  validateOrg,
  buildOrgTree,
} from '../public/org-chart.js';
import { readPersonnel } from '../lib/personnel.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = resolve(HERE, 'fixtures', 'repo');
const CLEAN_ROOT = resolve(HERE, 'fixtures', 'org-clean');
const MODULE_PATH = resolve(HERE, '..', 'public', 'org-chart.js');

/** A roster entry with the eight fields lib/personnel.js emits. */
const emp = (o) => ({
  actorId: 'agent:x',
  name: 'X',
  title: '',
  class: 'ic',
  reportsTo: BOARD_ROOT,
  team: '',
  hired: '',
  status: 'active',
  ...o,
});

// --- V1: purity -------------------------------------------------------------

test('org: the module is pure — no imports, no fs, no fetch, no DOM, no clock', () => {
  // Comments are stripped first: the module's own prose names fetch, fs and
  // the DOM while its CODE must not. Grepping the raw source would pass or
  // fail on documentation, which is not what purity means.
  const code = readFileSync(MODULE_PATH, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^.*$/gm, (line) => (line.includes('//') ? line.slice(0, line.indexOf('//')) : line));
  for (const banned of [
    /\bimport\b/,
    /\brequire\s*\(/,
    /\bnode:/,
    /\bfetch\s*\(/,
    /\bdocument\b/,
    /\bwindow\b/,
    /\bglobalThis\b/,
    /\blocalStorage\b/,
    /\bprocess\b/,
    /\bDate\b/,
    /Math\.random/,
  ]) {
    assert.doesNotMatch(code, banned, `org-chart.js code must not contain ${banned}`);
  }
  assert.equal(typeof validateOrg, 'function');
  assert.equal(typeof buildOrgTree, 'function');
});

// --- V2 cardinality: how many rules exist, before how many were fired --------

test('org: ORG_RULES is exactly the nine documented codes', () => {
  assert.deepEqual(
    [...ORG_RULES],
    [
      'orphan_reports_to',
      'missing_reports_to',
      'reporting_cycle',
      'reports_to_ic',
      'unparsed_dossier',
      'duplicate_actor_id',
      'invalid_class',
      'invalid_status',
      'multiple_board_reports',
    ],
    'nine rules — every one of them needs a case below that fires it'
  );
  assert.equal(ORG_RULES.length, 9);
  assert.deepEqual([...VALID_CLASSES], ['cofounder', 'c-level', 'manager', 'ic']);
  assert.deepEqual([...VALID_STATUSES], ['active', 'departed']);
  assert.equal(BOARD_ROOT, 'human:forrest');
  assert.equal(BOARD_NODE.actorId, BOARD_ROOT);
  assert.ok(!VALID_CLASSES.includes(BOARD_NODE.class), 'the board node is never a valid employee');
});

// --- rule 1: orphan_reports_to (V3) -----------------------------------------

test('org: orphan_reports_to fires on an edge pointing at no dossier', () => {
  const roster = [
    emp({ actorId: 'agent:ceo', name: 'Ceo', class: 'cofounder' }),
    emp({ actorId: 'agent:dev', name: 'Dev', reportsTo: 'agent:ghost' }),
  ];
  assert.deepEqual(validateOrg({ roster }), [
    {
      rule: 'orphan_reports_to',
      actorId: 'agent:dev',
      file: null,
      detail: 'reports to agent:ghost, who has no dossier',
    },
  ]);
});

test('org: orphan_reports_to names a departed manager as the reason', () => {
  // A departed manager with live reports is a real organisational defect, and
  // the fix (re-point reports_to) is the one the message names outright.
  const roster = [
    emp({ actorId: 'agent:gone', name: 'Gone', class: 'manager', status: 'departed' }),
    emp({ actorId: 'agent:dev', name: 'Dev', reportsTo: 'agent:gone' }),
  ];
  assert.deepEqual(validateOrg({ roster }), [
    {
      rule: 'orphan_reports_to',
      actorId: 'agent:dev',
      file: null,
      detail: 'reports to agent:gone, who is departed',
    },
  ]);
});

// --- rule 2: missing_reports_to ---------------------------------------------

test('org: missing_reports_to fires on an empty reporting line', () => {
  const roster = [
    emp({ actorId: 'agent:ceo', name: 'Ceo', class: 'cofounder' }),
    emp({ actorId: 'agent:loose', name: 'Loose', reportsTo: '' }),
  ];
  assert.deepEqual(validateOrg({ roster }), [
    {
      rule: 'missing_reports_to',
      actorId: 'agent:loose',
      file: null,
      detail: 'has no reporting line',
    },
  ]);
});

// --- rule 3: reporting_cycle (V4) -------------------------------------------

test('org: reporting_cycle fires once per cycle and returns', { timeout: 5000 }, () => {
  // The timeout is the assertion that matters most here: the walk must never
  // follow a parent chain upward, because a cycle is an input we EXPECT.
  const two = [
    emp({ actorId: 'agent:b', name: 'B', class: 'manager', reportsTo: 'agent:a' }),
    emp({ actorId: 'agent:a', name: 'A', class: 'manager', reportsTo: 'agent:b' }),
  ];
  assert.deepEqual(validateOrg({ roster: two }), [
    {
      rule: 'reporting_cycle',
      actorId: 'agent:a',
      file: null,
      detail: 'reporting cycle: agent:a, agent:b',
    },
  ]);

  const three = [
    emp({ actorId: 'agent:r', name: 'R', class: 'manager', reportsTo: 'agent:q' }),
    emp({ actorId: 'agent:q', name: 'Q', class: 'manager', reportsTo: 'agent:p' }),
    emp({ actorId: 'agent:p', name: 'P', class: 'manager', reportsTo: 'agent:r' }),
  ];
  assert.deepEqual(validateOrg({ roster: three }), [
    {
      rule: 'reporting_cycle',
      actorId: 'agent:p',
      file: null,
      detail: 'reporting cycle: agent:p, agent:q, agent:r',
    },
  ]);
});

// --- rule 4: reports_to_ic (V5) ---------------------------------------------

test('org: reports_to_ic fires when a manager is class ic', () => {
  const roster = [
    emp({ actorId: 'agent:lead', name: 'Lead', class: 'ic' }),
    emp({ actorId: 'agent:dev', name: 'Dev', class: 'ic', reportsTo: 'agent:lead' }),
  ];
  assert.deepEqual(validateOrg({ roster }), [
    {
      rule: 'reports_to_ic',
      actorId: 'agent:dev',
      file: null,
      detail: 'reports to agent:lead, who is an ic',
    },
  ]);
});

test('org: reports_to_ic does not fire for cofounder, c-level or manager', () => {
  const roster = [
    emp({ actorId: 'agent:b1', name: 'B1', class: 'cofounder' }),
    emp({ actorId: 'agent:b2', name: 'B2', class: 'c-level', reportsTo: 'agent:b1' }),
    emp({ actorId: 'agent:b3', name: 'B3', class: 'manager', reportsTo: 'agent:b2' }),
    emp({ actorId: 'agent:r1', name: 'R1', reportsTo: 'agent:b1' }),
    emp({ actorId: 'agent:r2', name: 'R2', reportsTo: 'agent:b2' }),
    emp({ actorId: 'agent:r3', name: 'R3', reportsTo: 'agent:b3' }),
  ];
  assert.deepEqual(validateOrg({ roster }), []);
});

// --- rule 5: unparsed_dossier (V6) ------------------------------------------

test('org: unparsed_dossier fires on fenced-but-broken dossiers and spares README.md', () => {
  // LOAD-BEARING FIXTURE PROPERTY (plan §4.3 / §10.5): test/fixtures/repo/personnel
  // holds exactly six files — three that roster, two that are fenced but yield
  // no employee, and a README with no leading fence. Do not "fix" it; both the
  // skip set and its two orphan edges are what the on-disk cases assert.
  const data = readPersonnel(FIXTURE_ROOT);
  assert.equal(
    data.roster.length + data.skipped.length + 1,
    6,
    'six files: 3 rostered, 2 skipped, 1 README'
  );
  const unparsed = validateOrg(data).filter((v) => v.rule === 'unparsed_dossier');
  assert.deepEqual(unparsed, [
    {
      rule: 'unparsed_dossier',
      actorId: null,
      file: 'bad-actor-eve.md',
      detail: 'dossier yielded no employee (invalid_actor_id)',
    },
    {
      rule: 'unparsed_dossier',
      actorId: null,
      file: 'broken-mallory.md',
      detail: 'dossier yielded no employee (malformed_frontmatter)',
    },
  ]);
  // A file with no leading fence is not a dossier: it appears in no violation
  // of any rule, not merely in no unparsed_dossier violation.
  assert.deepEqual(
    validateOrg(data).filter((v) => v.file === 'README.md'),
    []
  );
});

// --- rule 6: duplicate_actor_id ---------------------------------------------

test('org: duplicate_actor_id fires when two files declare one identity', () => {
  const roster = [
    emp({ actorId: 'agent:ceo', name: 'Ceo', class: 'cofounder' }),
    emp({ actorId: 'agent:twin', name: 'Twin A', reportsTo: 'agent:ceo' }),
    emp({ actorId: 'agent:twin', name: 'Twin B', reportsTo: 'agent:ceo' }),
  ];
  const sources = [
    { file: 'ceo.md', actorId: 'agent:ceo' },
    { file: 'twin-two.md', actorId: 'agent:twin' },
    { file: 'twin-one.md', actorId: 'agent:twin' },
  ];
  assert.deepEqual(validateOrg({ roster, sources }), [
    {
      rule: 'duplicate_actor_id',
      actorId: 'agent:twin',
      file: null,
      detail: 'declared in twin-one.md, twin-two.md',
    },
  ]);
});

// --- rule 7: invalid_class --------------------------------------------------

test('org: invalid_class fires on a class outside the four', () => {
  // Load-bearing for reports_to_ic: a typo'd class silently disables the
  // mandated check, which is the classic vacuous pass in production.
  const roster = [
    emp({ actorId: 'agent:ceo', name: 'Ceo', class: 'cofounder' }),
    emp({ actorId: 'agent:odd', name: 'Odd', class: 'engineer', reportsTo: 'agent:ceo' }),
  ];
  assert.deepEqual(validateOrg({ roster }), [
    {
      rule: 'invalid_class',
      actorId: 'agent:odd',
      file: null,
      detail: 'class "engineer" is not one of cofounder, c-level, manager, ic',
    },
  ]);
});

// --- rule 8: invalid_status (V7) --------------------------------------------

test('org: invalid_status fires on the unfiltered roster', () => {
  // `status: activ` deletes a person from the sidebar, the chart, the CLI
  // roster and every DM affordance. They are BY DEFINITION not in the active
  // set, so a rule that only saw active employees could never report them.
  const roster = [
    emp({ actorId: 'agent:ceo', name: 'Ceo', class: 'cofounder' }),
    emp({ actorId: 'agent:typo', name: 'Typo', reportsTo: 'agent:ceo', status: 'activ' }),
  ];
  assert.deepEqual(validateOrg({ roster }), [
    {
      rule: 'invalid_status',
      actorId: 'agent:typo',
      file: null,
      detail: 'status "activ" is not one of active, departed',
    },
  ]);
  // Proof the entry really is outside the active set: the tree cannot see it.
  const { root, unplaced } = buildOrgTree(roster.filter((e) => e.status === 'active'));
  assert.deepEqual(
    root.reports.map((n) => n.actorId),
    ['agent:ceo']
  );
  assert.deepEqual(unplaced, []);
});

// --- rule 9: multiple_board_reports ------------------------------------------

test('org: multiple_board_reports fires on a second board report', () => {
  const roster = [
    emp({ actorId: 'agent:ceo', name: 'Ceo', class: 'cofounder' }),
    emp({ actorId: 'agent:cto', name: 'Cto', class: 'cofounder' }),
  ];
  assert.deepEqual(validateOrg({ roster }), [
    {
      rule: 'multiple_board_reports',
      actorId: null,
      file: null,
      detail: 'only the CEO reports to the board: agent:ceo, agent:cto',
    },
  ]);
});

// --- V9: ordering ------------------------------------------------------------

test('org: violations sort by (rule, actorId, file)', () => {
  // Recomputed from the returned array rather than hardcoded, so this stays an
  // ordering property and not a second copy of the expectations above.
  const roster = [
    emp({ actorId: 'agent:ceo', name: 'Ceo', class: 'cofounder' }),
    emp({ actorId: 'agent:cto', name: 'Cto', class: 'cofounder' }),
    emp({ actorId: 'agent:z', name: 'Z', reportsTo: '' }),
    emp({ actorId: 'agent:a', name: 'A', reportsTo: 'agent:ghost' }),
    emp({ actorId: 'agent:m', name: 'M', class: 'wizard', reportsTo: 'agent:ceo' }),
  ];
  const violations = validateOrg({ roster });
  assert.ok(violations.length >= 4, `expected several violations, got ${violations.length}`);
  for (const v of violations) assert.ok(ORG_RULES.includes(v.rule), `unknown rule ${v.rule}`);
  const keys = violations.map((v) => [v.rule, v.actorId ?? '', v.file ?? ''].join(' '));
  assert.deepEqual(keys, [...keys].sort(), 'violations arrive sorted by (rule, actorId, file)');
});

// --- V8: the clean case, LAST on purpose ------------------------------------

test('org: a clean roster yields zero violations', () => {
  // Meaningful only because every case above has been seen to fire. On its own
  // this assertion passes against a validator that can detect nothing at all.
  assert.deepEqual(validateOrg(readPersonnel(CLEAN_ROOT)), []);
  assert.deepEqual(validateOrg({ roster: [], skipped: [], sources: [] }), []);
  assert.deepEqual(validateOrg(), []);
});

// --- the tree builder (R2, R3, R9) ------------------------------------------

test('org: the tree roots at the board node and nests reports by name', () => {
  const active = readPersonnel(CLEAN_ROOT).roster.filter((e) => e.status === 'active');
  const { root, unplaced } = buildOrgTree(active);
  assert.equal(root.actorId, BOARD_ROOT);
  assert.equal(root.name, 'Forrest (Board)');
  assert.deepEqual(unplaced, []);
  assert.deepEqual(
    root.reports.map((n) => n.actorId),
    ['agent:fix-ceo']
  );
  const ceo = root.reports[0];
  assert.deepEqual(
    ceo.reports.map((n) => n.name),
    ['Tomas Fixture']
  );
  const cto = ceo.reports[0];
  assert.deepEqual(
    cto.reports.map((n) => n.actorId),
    ['agent:fix-dev']
  );
  // Every node carries what the view renders, and nothing viewer-relative.
  assert.deepEqual(Object.keys(cto).sort(), [
    'actorId',
    'class',
    'name',
    'reports',
    'team',
    'title',
  ]);
  // The departed dossier is in no tree at all.
  assert.equal(JSON.stringify(root).includes('fix-alum'), false);
});

test('org: every active employee appears exactly once — tree plus unplaced', () => {
  const walkIds = (t) => {
    const acc = [];
    const visit = (n) => {
      if (n.actorId !== BOARD_ROOT) acc.push(n.actorId);
      n.reports.forEach(visit);
    };
    visit(t.root);
    return [...acc, ...t.unplaced.map((n) => n.actorId)].sort();
  };

  const clean = readPersonnel(CLEAN_ROOT).roster.filter((e) => e.status === 'active');
  assert.equal(walkIds(buildOrgTree(clean)).length, clean.length, 'clean roster: nobody lost');

  const broken = [
    emp({ actorId: 'agent:ceo', name: 'Ceo', class: 'cofounder' }),
    emp({ actorId: 'agent:orphan', name: 'Orphan', reportsTo: 'agent:ghost' }),
    emp({ actorId: 'agent:a', name: 'A', class: 'manager', reportsTo: 'agent:b' }),
    emp({ actorId: 'agent:b', name: 'B', class: 'manager', reportsTo: 'agent:a' }),
  ];
  const ids = walkIds(buildOrgTree(broken));
  assert.equal(ids.length, broken.length, 'orphan + cycle roster: nobody lost');
  assert.deepEqual(ids, ['agent:a', 'agent:b', 'agent:ceo', 'agent:orphan']);
});

test('org: an orphaned employee is still shown, under Not placed', () => {
  const roster = [
    emp({ actorId: 'agent:ceo', name: 'Ceo', class: 'cofounder' }),
    emp({ actorId: 'agent:orphan', name: 'Orphan', title: 'Analyst', reportsTo: 'agent:ghost' }),
  ];
  const { root, unplaced } = buildOrgTree(roster);
  assert.deepEqual(
    root.reports.map((n) => n.actorId),
    ['agent:ceo']
  );
  assert.deepEqual(
    unplaced.map((n) => n.actorId),
    ['agent:orphan']
  );
  assert.equal(unplaced[0].title, 'Analyst', 'unplaced nodes carry the fields the tree does');
});

test('org: cycle members land in unplaced, never in the tree', () => {
  const roster = [
    emp({ actorId: 'agent:ceo', name: 'Ceo', class: 'cofounder' }),
    emp({ actorId: 'agent:a', name: 'A', class: 'manager', reportsTo: 'agent:b' }),
    emp({ actorId: 'agent:b', name: 'B', class: 'manager', reportsTo: 'agent:a' }),
  ];
  const { root, unplaced } = buildOrgTree(roster);
  assert.deepEqual(
    unplaced.map((n) => n.actorId),
    ['agent:a', 'agent:b']
  );
  assert.equal(JSON.stringify(root).includes('agent:a'), false, 'no cycle member in the tree');
  assert.equal(JSON.stringify(root).includes('agent:b'), false, 'no cycle member in the tree');
});

test('org: an empty roster still yields the board node, and junk degrades', () => {
  for (const input of [[], null, undefined, 'nope', [null]]) {
    const { root, unplaced } = buildOrgTree(input);
    assert.equal(root.actorId, BOARD_ROOT);
    assert.deepEqual(root.reports, []);
    assert.deepEqual(unplaced, []);
  }
  // A missing personnel/ directory is empty, not a violation.
  const bare = mkdtempSync(join(tmpdir(), 'org-bare-'));
  try {
    assert.deepEqual(validateOrg(readPersonnel(bare)), []);
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});
