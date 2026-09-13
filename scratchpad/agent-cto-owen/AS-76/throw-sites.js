// AS-76 §4.3 evidence: how many error messages in apps/invoicing interpolate a
// runtime value, and which of those interpolate something on the deny-list.
//
// Scope mirrors the dependency-policy walker: app source only, top-level
// test/, vendor/, demo/, node_modules/ skipped. Line-oriented on purpose — a
// `throw new` split across lines is undercounted, which errs LOW, and the
// argument is "at least this many", so undercounting is the safe direction.
//
// Receipt: throw-sites.txt
const fs = require('fs');
const path = require('path');

const ROOT = '/Users/forrest/Code/american-software-company/apps/invoicing';
const SKIP = new Set(['node_modules', 'test', 'vendor', 'demo', '.git']);

const files = [];
(function walk(dir, depth) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (depth === 0 && SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (/\.js$/.test(e.name)) files.push(p);
  }
})(ROOT, 0);

const THROW = /throw new [A-Za-z]*Error\(/;
const INTERP = /\$\{/;

let sites = 0;
const interpolating = [];
for (const f of files) {
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (!THROW.test(line)) return;
    sites += 1;
    if (INTERP.test(line)) interpolating.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
  });
}

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };

say(`files scanned: ${files.length}`);
say(`throw new *Error( sites: ${sites}`);
say(`of which interpolate a runtime value into the message: ${interpolating.length}`);
say('');
say('--- the interpolating sites ---');
for (const l of interpolating) say(l);

// The subset that interpolates something the AS-76 deny-list names explicitly.
say('');
say('--- sites interpolating a DENY-LISTED value ---');
const DENY_HIT = /stripe[A-Za-z]*Id|\$\{value\}|config\.dbPath|JSON\.stringify\(raw\)/;
const hits = interpolating.filter((l) => DENY_HIT.test(l));
for (const l of hits) say(l);
say(`count: ${hits.length}`);

fs.writeFileSync(path.join(__dirname, 'throw-sites.txt'), lines.join('\n') + '\n');
