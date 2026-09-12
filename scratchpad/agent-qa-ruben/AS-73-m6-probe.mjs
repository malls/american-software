// AS-73 M6 probe (qa-ruben): parser/classifier AGREEMENT on fence malformations
// the plan did not name. Property under test: for every text, exactly one of
//   (a) parseFrontmatter(text) !== null            -> roster or later-stage skip
//   (b) parseFrontmatter null && hasLeadingFence   -> skipped malformed_frontmatter
//   (c) parseFrontmatter null && !hasLeadingFence  -> silently dropped (README class)
// holds AND readPersonnel's examined invariant closes. Agreement, not acceptance.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFrontmatter, hasLeadingFence, readPersonnel } from '/Users/forrest/Code/american-software-company/.worktrees/AS-73/apps/chat/lib/personnel.js';

const cases = {
  'crlf-alone.md': '---\r\n',                       // plan §10's named example
  'blank-first.md': '\n---\nactor_id: agent:b\nname: B\nstatus: active\n---\n', // fence preceded by a blank line
  'lone-cr.md': '---\ractor_id: agent:cr\rname: Cr\rstatus: active\r---\r',      // classic-Mac line endings: fence + everything on "one line"
  'crlf-trail-space.md': '--- \r\nactor_id: agent:ts\r\nname: Ts\r\nstatus: active\r\n---\r\n',
  'double-bom.md': '﻿﻿---\nactor_id: agent:dbom\nname: Dbom\nstatus: active\n---\n',
  'nbsp-lead.md': ' ---\nactor_id: agent:nb\nname: Nb\nstatus: active\n---\n', // NBSP is in trim()'s set
  'four-dash.md': '----\nactor_id: agent:fd\nname: Fd\n---\n',
  'empty.md': '',
  'ws-only.md': '   \n\n',
  'fence-tab-inside.md': '-\t--\nactor_id: agent:x\n---\n',
  'closing-crlf-only.md': '---\nactor_id: agent:cc\nname: Cc\nstatus: active\n---\r\n',
  'bom-then-blank.md': '﻿\n---\nactor_id: agent:bb\nname: Bb\n---\n',
};

const root = mkdtempSync(join(tmpdir(), 'qa-ruben-as73-m6-'));
mkdirSync(join(root, 'personnel'));
for (const [f, t] of Object.entries(cases)) writeFileSync(join(root, 'personnel', f), t, 'utf8');
mkdirSync(join(root, 'personnel', 'dir.md')); // a DIRECTORY named *.md: examined? classified?

const data = readPersonnel(root);
const rows = [];
let noFence = 0;
let disagreements = 0;
for (const f of Object.keys(cases).concat(['dir.md']).sort()) {
  const text = cases[f];
  const fm = f === 'dir.md' ? '(dir)' : parseFrontmatter(text);
  const lead = f === 'dir.md' ? '(dir)' : hasLeadingFence(text);
  const inRoster = data.roster.some((r) => data.sources.find((s) => s.file === f && s.actorId === r.actorId));
  const skip = data.skipped.find((s) => s.file === f)?.reason ?? null;
  let expect;
  if (f === 'dir.md') expect = 'unreadable';
  else if (fm !== null) expect = inRoster ? 'roster' : skip; // later-stage skip is fine
  else if (lead) expect = 'malformed_frontmatter';
  else { expect = 'dropped'; noFence++; }
  const got = inRoster ? 'roster' : skip ?? 'dropped';
  const agree = expect === got;
  if (!agree) disagreements++;
  rows.push({ file: f, parsed: fm === null ? 'null' : fm === '(dir)' ? '(dir)' : 'obj', leadingFence: lead, classified: got, agree });
}
console.table(rows);
const md = Object.keys(cases).length + 1;
console.log('examined', data.examined, 'expected .md entries', md);
console.log('invariant examined === roster + skipped + noFence:', data.examined, '===', data.roster.length, '+', data.skipped.length, '+', noFence, '=>', data.examined === data.roster.length + data.skipped.length + noFence);
console.log('roster ids', data.roster.map((r) => r.actorId));
console.log('skipped', JSON.stringify(data.skipped));
console.log('disagreements', disagreements, 'of', rows.length);
rmSync(root, { recursive: true, force: true });
process.exit(disagreements === 0 && data.examined === md ? 0 : 1);
