#!/usr/bin/env node
// bin/check-org.js — the org-chart gate (AS-33).
//
// Reads personnel/ frontmatter, runs the nine rules in public/org-chart.js,
// prints one line per violation and exits non-zero if there are any. This is
// the artifact that makes the CLAUDE.md "Org Chart" obligation enforceable
// rather than aspirational: a hire, a departure, or a reporting-line change is
// not complete until this exits 0.
//
// Why a separate binary and not a `chat org` subcommand: bin/chat.js resolves
// a backend mode and opens the chat database on every invocation, and CLAUDE.md
// records that ticks must not run bin/chat.js at all while the server container
// is up (AS-24, the WAL divergence that orphaned message 161). An org check
// needs no database, so routing it through chat.js would inherit a hazard it
// has no reason to carry and would make it unrunnable by exactly the caller who
// most needs it. This process opens no store, probes no server, and reads only
// personnel/*.md — which is also why running it as bare host `node` does not
// offend compose.yaml's "no bare node on the host" rule (that rule is about the
// server and its database).
//
// And why it is not a test: the test service mounts nothing, deliberately —
// the suite passing mountless is the proof that the tests touch no real state.
// The suite proves the validator can detect things; this proves the roster.
// Neither substitutes for the other.
//
//   node apps/chat/bin/check-org.js [--root <path>] [--json]
//
// Exit: 0 no violations, 1 one or more violations, 2 usage error.

import { readPersonnel } from '../lib/personnel.js';
import { latticeRoot } from '../lib/lattice.js';
import { validateOrg } from '../public/org-chart.js';

const USAGE = 'usage: check-org [--root <path>] [--json]';

function parseArgs(argv) {
  const opts = { root: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') {
      opts.json = true;
    } else if (a === '--root') {
      const value = argv[++i];
      if (value === undefined) return { error: "--root requires a path" };
      opts.root = value;
    } else if (a === '--help' || a === '-h') {
      return { error: null, help: true, ...opts };
    } else {
      return { error: `unknown argument: ${a}` };
    }
  }
  return opts;
}

const args = parseArgs(process.argv.slice(2));
if (args.error) {
  process.stderr.write(`${args.error}\n${USAGE}\n`);
  process.exit(2);
}
if (args.help) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

const root = args.root ?? latticeRoot();
const data = readPersonnel(root);
const violations = validateOrg(data);
const active = data.roster.filter((e) => e.status === 'active');
const employees = active.map((e) => ({
  actorId: e.actorId,
  name: e.name,
  title: e.title,
  class: e.class,
  team: e.team,
  reportsTo: e.reportsTo,
}));

if (args.json) {
  // Same shape as GET /api/org, so the two can be diffed against each other.
  process.stdout.write(`${JSON.stringify({ employees, violations }, null, 2)}\n`);
  process.exit(violations.length > 0 ? 1 : 0);
}

if (data.roster.length === 0 && data.skipped.length === 0) {
  // Degradation contract, matching `chat roster`: absence is not a violation,
  // and inventing one would make this command useless in a bare checkout.
  process.stdout.write('No personnel records found (personnel/ missing or empty).\n');
  process.exit(0);
}

process.stdout.write(
  `${active.length} active of ${data.roster.length} dossiers parsed, ` +
    `${data.skipped.length} unparsed, in ${root}/personnel\n`
);

if (violations.length === 0) {
  process.stdout.write('No violations.\n');
  process.exit(0);
}

const rows = violations.map((v) => [v.rule, v.actorId ?? v.file ?? '-', v.detail]);
const width = (i) => Math.max(...rows.map((r) => r[i].length));
for (const r of rows) {
  process.stdout.write(`${r[0].padEnd(width(0))}  ${r[1].padEnd(width(1))}  ${r[2]}\n`);
}
process.stdout.write(
  `${violations.length} violation${violations.length === 1 ? '' : 's'}.\n`
);
process.exit(1);
