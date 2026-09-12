// AS-112 review mutation driver — agent:qa-ruben. Runs against the DETACHED
// scratch worktree /tmp/AS-112-ruben-mutant, never $W. One mutant per
// invocation: mutate, assert applied at the intended site, run the whole
// suite (TAP), restore under an exit handler, prove porcelain empty.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const S = '/tmp/AS-112-ruben-mutant';
const CHAT = `${S}/apps/chat`;
const CSS = `${CHAT}/public/style.css`;
const APP = `${CHAT}/public/app.js`;
const T1F = `${CHAT}/test/roster-truncation.test.js`;
const LOG = '/Users/forrest/Code/american-software-company/scratchpad/agent-qa-ruben/AS-112/mutants.log';

const name = process.argv[2];
const files = process.argv[3] || 'all'; // 'all' | 't1' (roster-truncation only) — battery uses 'all'

const git = (...a) => spawnSync('git', ['-C', S, ...a], { encoding: 'utf8' });
const restore = () => {
  git('checkout', '--', 'apps/chat/public', 'apps/chat/test');
  const p = git('status', '--porcelain').stdout.trim();
  if (p !== '') { console.error(`RESTORE FAILED, porcelain:\n${p}`); process.exitCode = 9; }
  else console.log('restored: porcelain empty');
};
process.on('exit', restore);

const region = (app) => {
  const start = app.indexOf('function orgNodeItem(node) {');
  return app.slice(start, app.indexOf('\n}\n', start));
};
const count = (s, needle) => s.split(needle).length - 1;

const css0 = readFileSync(CSS, 'utf8');
const app0 = readFileSync(APP, 'utf8');
const metaLine = "  const meta = [node.title, node.class, node.team].filter(Boolean).join(' \\u00b7 ');\n";
const insertBeforeMeta = (line) => {
  if (count(app0, metaLine) !== 1) throw new Error('meta line not unique');
  return app0.replace(metaLine, line + metaLine);
};
const appendCss = (rule) => css0 + rule;

// applied: () => boolean, checked AFTER writing
const MUTANTS = {
  // --- plan §2 battery ---
  M1: { css: appendCss('\n.roster-title { all: unset; }\n'),
    applied: (c) => count(c, '.roster-title {') === 3 && c.lastIndexOf('.roster-title {') > c.indexOf('.roster-status {') },
  M2: { css: appendCss('\n#roster-list { .roster-title { white-space: normal; } }\n'),
    applied: (c) => count(c, '#roster-list { .roster-title {') === 1 },
  M2b: { css: appendCss('\n.roster-title { & { white-space: normal; } }\n'),
    applied: (c) => count(c, '& { white-space: normal; }') === 1 },
  M3: { app: insertBeforeMeta('  row.appendChild(el("span", "org-extra"));\n'),
    applied: (_, a) => count(region(a), 'el("') === 1 },
  M3b: { app: insertBeforeMeta("  row.appendChild(el('span', 'org-extra'));\n"),
    applied: (_, a) => count(region(a), 'org-extra') === 1 },
  M4: { app: insertBeforeMeta("  row.classList.add('org-extra');\n"),
    applied: (_, a) => count(region(a), 'classList.add') === 2 },
  R1: { css: appendCss('\n.roster-title { white-space: normal; }\n'),
    applied: (c) => count(c, '.roster-title {') === 3 },
  R2: { css: css0.replace('/* AS-32: the employee\'s title', '#roster-list .roster-title { white-space: normal; }\n/* AS-32: the employee\'s title'),
    applied: (c) => count(c, '#roster-list .roster-title { white-space: normal; }') === 1 && c.indexOf('#roster-list .roster-title { white-space: normal; }') < c.indexOf('\n.roster-title {') },
  R3: { app: app0.replace(metaLine, "  const meta = node.title || '';\n"),
    applied: (_, a) => count(region(a), 'node.class') === 0 },
  R4: { app: app0.replace('  item.append(top);\n', '  item.append(top);\n  item.append(el("div", "roster-extra"));\n'),
    applied: (_, a) => count(a, 'roster-extra') === 1 && count(a, 'item.append(el("div", "roster-extra"))') === 1 },
  // --- H6 flip (AC-6) ---
  H6flip: { t1: readFileSync(T1F, 'utf8').replace(
    "assert.throws(() => parseRules('#r { .t { white-space: normal; } }'), /cannot score nested style rule/);",
    "assert.doesNotThrow(() => parseRules('#r { .t { white-space: normal; } }'));"),
    applied: (_, __, t) => count(t, "assert.doesNotThrow(() => parseRules('#r { .t") === 1 },
  // --- §6 named probes (M6, past the list) ---
  P_revertlayer: { css: appendCss('\n.roster-title { all: revert-layer; }\n'), applied: (c) => count(c, 'all: revert-layer') === 1 },
  P_initial: { css: appendCss('\n.roster-title { all: initial; }\n'), applied: (c) => count(c, 'all: initial') === 1 },
  P_media_inside: { css: appendCss('\n.roster-title { @media (max-width: 700px) { white-space: normal; } }\n'), applied: (c) => count(c, '.roster-title { @media') === 1 },
  P_is_nested: { css: appendCss('\n#roster-list { .roster-title:is(.x) { white-space: normal; } }\n'), applied: (c) => count(c, '.roster-title:is(.x)') === 1 },
  P_brace_string: { css: appendCss('\n.roster-status::after { content: "{"; }\n.roster-title { white-space: normal; }\n'), applied: (c) => count(c, 'content: "{"') === 1 && count(c, '.roster-title {') === 3 },
  P_className: { app: insertBeforeMeta("  row.className = 'org-extra';\n"), applied: (_, a) => count(region(a), "className = 'org-extra'") === 1 },
  P_setAttr: { app: insertBeforeMeta("  row.setAttribute('class', 'org-extra');\n"), applied: (_, a) => count(region(a), "setAttribute('class'") === 1 },
  P_render_el: { app: app0.replace("  const nodes = [];\n", "  const nodes = [];\n  nodes.push(el('span', 'org-extra'));\n"),
    applied: (_, a) => count(a, "el('span', 'org-extra')") === 1 && count(region(a), 'org-extra') === 0 },
  // --- Ruben's invented routes (neither plan nor parent review named) ---
  X_type_subject: { css: appendCss('\n#roster-list li.roster-row div { white-space: normal; }\n'), applied: (c) => count(c, 'li.roster-row div { white-space: normal') === 1 },
  X_universal: { css: appendCss('\n#roster-list * { white-space: normal; }\n'), applied: (c) => count(c, '#roster-list * { white-space: normal') === 1 },
  X_attr_class: { css: appendCss('\n[class~="roster-title"] { white-space: normal; }\n'), applied: (c) => count(c, '[class~="roster-title"]') === 1 },
  X_escaped: { css: appendCss('\n.roster\\-title { white-space: normal; }\n'), applied: (c) => count(c, '.roster\\-title {') === 1 },
  X_scope: { css: appendCss('\n@scope (#roster-list) { .roster-title { white-space: normal; } }\n'), applied: (c) => count(c, '@scope (#roster-list)') === 1 },
  X_layer_important: { css: appendCss('\n@layer x { .roster-title { white-space: normal !important; } }\n'), applied: (c) => count(c, '@layer x {') === 1 },
  X_import_swallow: { css: appendCss('\n@import url("x.css");\n.roster-title { white-space: normal; }\n'), applied: (c) => count(c, '@import url("x.css");') === 1 && count(c, '.roster-title {') === 3 },
  X_media_type_subject: { css: appendCss('\n@media (min-width: 0px) { #roster-list div { white-space: normal; } }\n'), applied: (c) => count(c, '#roster-list div { white-space') === 1 },
};

const m = MUTANTS[name];
if (!m) { console.error(`unknown mutant ${name}; known: ${Object.keys(MUTANTS).join(' ')}`); process.exit(2); }
if (m.css) writeFileSync(CSS, m.css);
if (m.app) writeFileSync(APP, m.app);
if (m.t1) writeFileSync(T1F, m.t1);
const cssN = readFileSync(CSS, 'utf8'), appN = readFileSync(APP, 'utf8'), t1N = readFileSync(T1F, 'utf8');
const diffStat = git('diff', '--stat').stdout.trim();
if (!m.applied(cssN, appN, t1N)) { console.error(`MUTATION ${name} NOT APPLIED AT SITE\n${diffStat}`); process.exit(3); }
console.log(`${name}: applied at site. diff --stat:\n${diffStat}`);

const args = files === 't1' ? ['--test', '--test-reporter=tap', 'test/roster-truncation.test.js'] : ['--test', '--test-reporter=tap'];
const r = spawnSync('node', args, { cwd: CHAT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = r.stdout + r.stderr;
const failing = [...out.matchAll(/^not ok \d+ - (.+)$/gm)].map((x) => x[1]);
const totals = Object.fromEntries([...out.matchAll(/^# (tests|pass|fail|skipped) (\d+)$/gm)].map((x) => [x[1], Number(x[2])]));
const summary = `${name} [${files}]: ${JSON.stringify(totals)} exit ${r.status}\n  RED SET (${failing.length}): ${failing.map((f) => `\n    - ${f}`).join('')}`;
console.log(summary);
// first error message lines for each failure, for the record
for (const f of failing) {
  const i = out.indexOf(`not ok`, out.indexOf(f));
  const chunk = out.slice(i, i + 900);
  const msg = (chunk.match(/error: ['"|]?([\s\S]{0,400}?)(\n\s+code:|\n\s+stack:|\n\s+name:)/) || [])[1];
  if (msg) console.log(`  MSG[${f.slice(0, 40)}]: ${msg.replace(/\s+/g, ' ').trim()}`);
}
appendFileSync(LOG, `${new Date().toISOString()} ${summary}\n`);
