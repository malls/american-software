// AS-28 rework cycle 1 — mutation battery for the AC-3 palette guard.
// Every mutant runs on a fresh scratch copy of apps/chat (the worktree is never
// mutated). Each mutant asserts it applied AT THE INTENDED SITE before the suite
// runs; an unapplied or wrong-site mutation is reported as such, not as a pass.
import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-28/apps/chat';
const TMP = '/tmp/as28-mutants';

// [id, description, file, mutate(text) -> text, siteCheck(before, after) -> string|null (error)]
const one = (before, after, needle) => {
  const b = before.split('\n').findIndex((l) => l.includes(needle));
  const a = after.split('\n').findIndex((l) => l.includes(needle));
  return { beforeLine: b + 1, afterLine: a + 1 };
};

const MUTANTS = [
  {
    id: 'M1',
    desc: "server.js: delete the '/favicon.svg' STATIC_FILES entry",
    file: 'server.js',
    mutate(t) {
      const lines = t.split('\n');
      const i = lines.findIndex((l) => l.includes("'/favicon.svg': ["));
      if (i === -1) return null;
      this.site = `L${i + 1}: ${lines[i].trim()}  | neighbour L${i}: ${lines[i - 1].trim()}`;
      lines.splice(i, 1);
      return lines.join('\n');
    },
    verify(after) {
      if (after.includes('/favicon.svg')) return 'entry still present';
      if (!after.includes("'/style.css': [")) return 'wrong site: /style.css neighbour also gone';
      return null;
    },
  },
  {
    id: 'M2',
    desc: 'index.html: delete the <link rel="icon"> line',
    file: 'public/index.html',
    mutate(t) {
      const lines = t.split('\n');
      const i = lines.findIndex((l) => l.includes('rel="icon"'));
      if (i === -1) return null;
      this.site = `L${i + 1}: ${lines[i].trim()}`;
      lines.splice(i, 1);
      return lines.join('\n');
    },
    verify(after) {
      if (after.includes('rel="icon"')) return 'link still present';
      if (!after.includes('rel="stylesheet"')) return 'wrong site: stylesheet link also gone';
      return null;
    },
  },
  {
    id: 'M3a',
    desc: 'favicon.svg: <path> fill #1C41E3 -> #FF0000 (comment untouched)',
    file: 'public/favicon.svg',
    mutate(t) {
      if (!t.includes('<path fill="#1C41E3"')) return null;
      const out = t.replace('<path fill="#1C41E3"', '<path fill="#FF0000"');
      this.site = JSON.stringify(one(t, out, 'fill="#FF0000"'));
      return out;
    },
    verify(after) {
      if (!/<path fill="#FF0000"/.test(after)) return 'path fill not repainted';
      if (!after.includes('#1C41E3 = --color-accent-500')) return 'wrong site: comment was edited';
      return null;
    },
  },
  {
    id: 'M3b',
    desc: 'favicon.svg: strip every 6-hex value file-wide (comment + paints -> fill="")',
    file: 'public/favicon.svg',
    mutate(t) {
      const out = t.replace(/#[0-9A-Fa-f]{6}/g, '');
      this.site = `hex occurrences removed: ${(t.match(/#[0-9A-Fa-f]{6}/g) || []).length}`;
      return out === t ? null : out;
    },
    verify(after) {
      if (/#[0-9A-Fa-f]{6}/.test(after)) return 'hex survived';
      if (!/<path fill=""/.test(after)) return 'wrong site: path fill attribute not emptied';
      return null;
    },
  },
  {
    id: 'M3c',
    desc: 'favicon.svg: paints -> red/lime named colours, XML comment left intact',
    file: 'public/favicon.svg',
    mutate(t) {
      let out = t.replace('<path fill="#1C41E3"', '<path fill="red"');
      out = out.replace(/<circle fill="#FFFFFF"/g, '<circle fill="lime"');
      this.site = `path->red, circles->lime (${(t.match(/<circle fill="#FFFFFF"/g) || []).length} circles)`;
      return out === t ? null : out;
    },
    verify(after) {
      if (!after.includes('<path fill="red"')) return 'path not repainted red';
      if ((after.match(/<circle fill="lime"/g) || []).length !== 3) return 'circles not all repainted lime';
      if (!after.includes('#1C41E3 = --color-accent-500, #FFFFFF = --color-ink-white'))
        return 'wrong site: the XML comment must survive intact (that is the point of this mutant)';
      if (/fill="#/.test(after)) return 'a hex paint survived';
      return null;
    },
  },
  {
    id: 'M3d',
    desc: 'favicon.svg: <path> fill #1C41E3 -> #1C41E3FF (8-digit hex with alpha)',
    file: 'public/favicon.svg',
    mutate(t) {
      if (!t.includes('<path fill="#1C41E3"')) return null;
      const out = t.replace('<path fill="#1C41E3"', '<path fill="#1C41E3FF"');
      this.site = JSON.stringify(one(t, out, 'fill="#1C41E3FF"'));
      return out;
    },
    verify(after) {
      if (!after.includes('<path fill="#1C41E3FF"')) return 'alpha hex not applied on the path';
      if (!after.includes('#1C41E3 = --color-accent-500')) return 'wrong site: comment was edited';
      return null;
    },
  },
  {
    id: 'M3e',
    desc: 'favicon.svg: remove every paint attribute (0 paints), comment intact',
    file: 'public/favicon.svg',
    mutate(t) {
      const out = t.replace(/ fill="#[0-9A-Fa-f]{6}"/g, '');
      this.site = `paint attributes removed: ${(t.match(/ fill="#[0-9A-Fa-f]{6}"/g) || []).length}`;
      return out === t ? null : out;
    },
    verify(after) {
      if (/fill=/.test(after)) return 'a paint attribute survived';
      if (!after.includes('<path d="M6 3h20')) return 'wrong site: the path geometry was damaged';
      if (!after.includes('#1C41E3 = --color-accent-500')) return 'wrong site: comment was edited';
      return null;
    },
  },
  {
    id: 'M3f',
    desc: 'favicon.svg: add style="fill:red" to the <path>, palette fills intact',
    file: 'public/favicon.svg',
    mutate(t) {
      if (!t.includes('<path fill="#1C41E3"')) return null;
      const out = t.replace('<path fill="#1C41E3"', '<path style="fill:red" fill="#1C41E3"');
      this.site = JSON.stringify(one(t, out, 'style="fill:red"'));
      return out;
    },
    verify(after) {
      if (!after.includes('<path style="fill:red" fill="#1C41E3"')) return 'style attribute not added to the path';
      if ((after.match(/<circle fill="#FFFFFF"/g) || []).length !== 3) return 'wrong site: circles changed';
      return null;
    },
  },
];

function runSuite(dir) {
  const r = spawnSync(process.execPath, ['--test'], { cwd: dir, encoding: 'utf8', timeout: 600000 });
  const out = (r.stdout || '') + (r.stderr || '');
  // node --test uses the spec reporter here, not TAP: 'ℹ tests N' summary lines
  // and a trailing '✖ failing tests:' section. Parsing TAP against this output
  // returned "0 red" for every mutant — i.e. the harness, not the guard, was
  // vacuous. Counts are asserted non-null below so that cannot recur silently.
  const counts = {};
  for (const k of ['tests', 'pass', 'fail']) {
    const m = out.match(new RegExp(`^\\u2139 ${k} (\\d+)$`, 'm'));
    counts[k] = m ? Number(m[1]) : null;
  }
  const at = out.indexOf('✖ failing tests:');
  const section = at === -1 ? '' : out.slice(at);
  const failed = [...section.matchAll(/^✖ (.+?) \([\d.]+ms\)$/gm)].map((m) => m[1].trim());
  if (counts.tests === null) throw new Error('suite output not understood — refusing to report a red set');
  if (counts.fail !== failed.length) {
    throw new Error(`parsed ${failed.length} failing names but the suite reported ${counts.fail}`);
  }
  return { failed, counts, status: r.status };
}

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const only = process.argv[2] ? process.argv[2].split(',') : null;
const results = [];
for (const m of MUTANTS) {
  if (only && !only.includes(m.id)) continue;
  const dir = join(TMP, m.id);
  cpSync(SRC, dir, { recursive: true });
  const path = join(dir, m.file);
  const before = readFileSync(path, 'utf8');
  const after = m.mutate.call(m, before);
  if (after === null || after === before) {
    results.push({ id: m.id, applied: false, reason: 'mutation did not apply (pattern missed)' });
    continue;
  }
  writeFileSync(path, after);
  const wrong = m.verify(readFileSync(path, 'utf8'));
  if (wrong) {
    results.push({ id: m.id, applied: false, reason: `site assertion failed: ${wrong}` });
    continue;
  }
  const res = runSuite(dir);
  results.push({ id: m.id, desc: m.desc, applied: true, site: m.site, ...res });
}

for (const r of results) {
  console.log('='.repeat(72));
  console.log(`${r.id} — ${r.desc || ''}`);
  if (!r.applied) { console.log(`  NOT APPLIED: ${r.reason}`); continue; }
  console.log(`  site: ${r.site}`);
  console.log(`  suite: tests=${r.counts.tests} pass=${r.counts.pass} fail=${r.counts.fail} exit=${r.status}`);
  console.log(`  red set (${r.failed.length}): ${r.failed.length ? r.failed.join(' | ') : 'NONE — SURVIVOR'}`);
}
