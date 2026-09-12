// The plan's own mutant set (M1, M1b, M2, M3, M5, M4i, M4ii) re-run at the cycle-2 tip.
// Usage: node plan-mutants.mjs <m1|m1b|m2|m3|m5|m4i|m4ii>
import { mutant, APP, WT, read, write, git } from './harness.mjs';
import { join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';

const which = process.argv[2];
const M = {
  m1: () => mutant({
    name: 'M1 compose.override.yaml with outbound healthcheck', suffix: '10', log: 'run10-M1-override.log',
    touch: [join(APP, 'compose.override.yaml')],
    apply() { write(join(APP, 'compose.override.yaml'), "services:\n  web:\n    healthcheck:\n      test: [\"CMD\", \"node\", \"-e\", \"fetch('https://example.invalid/')\"]\n"); },
    applied: () => read(join(APP, 'compose.override.yaml')).includes("fetch('https://example.invalid/')"),
    predict: 'red exactly {DP#3 "found 4 manifests", DP#5 compose.override.yaml:4: fetch}, 532/511/2/19',
  }),
  m1b: () => {
    const F = join(APP, 'Dockerfile');
    const LIST = `COPY apps/invoicing/app.js apps/invoicing/server.js ./
COPY apps/invoicing/lib ./lib
COPY apps/invoicing/routes ./routes
COPY apps/invoicing/views ./views
COPY apps/invoicing/public ./public
COPY apps/invoicing/test ./test
COPY apps/invoicing/demo ./demo
COPY apps/invoicing/compose.yaml apps/invoicing/Dockerfile ./
`;
    mutant({
      name: 'M1b explicit eight-line COPY list in place of the whole-directory COPY', suffix: '11', log: 'run11-M1b-explicit-list.log',
      touch: [F],
      apply() { write(F, read(F).replace('COPY apps/invoicing ./\n', LIST)); },
      applied: () => !read(F).includes('COPY apps/invoicing ./\n') && read(F).includes(LIST),
      predict: 'red exactly {DS-1, DS-demo, DS-ride}, 532/510/3/19; dependency-policy green',
    });
  },
  m2: () => {
    const D = join(APP, 'lib', 'vendor');
    mutant({
      name: 'M2 lib/vendor/probe.js (depth 1) with fetch', suffix: '12', log: 'run12-M2-nested-vendor.log',
      touch: [D],
      apply() { write(join(D, 'probe.js'), "export function probe() { return fetch('https://example.invalid/'); }\n"); },
      applied: () => read(join(D, 'probe.js')).includes('fetch('),
      predict: 'red exactly {DP#3 assertion 0 naming lib/vendor, DP#5 lib/vendor/probe.js:1: fetch}, 532/511/2/19',
    });
  },
  m3: () => {
    const F = join(APP, 'compose.yaml');
    const LINE = "    container_name: \"asc-inv \\\" # fetch('https://example.invalid/')\"\n";
    mutant({
      name: 'M3 container_name with an escaped quote hiding fetch(', suffix: '13', log: 'run13-M3-escaped-quote.log',
      touch: [F],
      apply() { write(F, read(F).replace('services:\n  web:\n', 'services:\n  web:\n' + LINE)); },
      applied: () => read(F).includes(LINE),
      predict: 'red exactly {DP#5 compose.yaml:32: fetch — not sanctioned}, 532/512/1/19; deploy-shape green',
    });
  },
  m5: () => {
    const F = join(APP, 'test', 'helpers', 'hash-comment.js');
    const LINE = "      if (quote === '\"' && ch === '\\\\') { i += 1; continue; }\n";
    mutant({
      name: "M5 delete the helper's escape line", suffix: '14', log: 'run14-M5-drop-escape.log',
      touch: [F],
      apply() { write(F, read(F).replace(LINE, '')); },
      applied: () => !read(F).includes(LINE) && read(F).includes('stripTrailingHashComment'),
      predict: 'red exactly {DP#2, DS-parse}, 532/511/2/19',
    });
  },
  m4i: () => {
    const P = join(APP, 'lib', '.DS_Store');
    mutant({
      name: 'M4(i) plant lib/.DS_Store (dockerignored)', suffix: '15', log: 'run15-M4i-dsstore-ignored.log',
      touch: [P],
      apply() {
        writeFileSync(P, Buffer.from('Bud1\0\0\0\0finder junk\n', 'latin1'));
        const ci = git('check-ignore', '-q', P) ; // empty stdout either way; use status instead
        const st = git('status', '--porcelain', '--ignored', '--', P);
        console.log(`git status --ignored on the plant: '${st}' (expect !! = ignored)`);
      },
      applied: () => read(P).startsWith('Bud1'),
      predict: 'green 532/513/0/19 and the plant is gitignored',
    });
  },
  m4ii: () => {
    const P = join(APP, 'lib', '.DS_Store');
    const IG = join(WT, '.dockerignore');
    mutant({
      name: 'M4(ii) lib/.DS_Store planted AND **/.DS_Store removed from .dockerignore', suffix: '16', log: 'run16-M4ii-dsstore-unignored.log',
      touch: [P, IG],
      apply() {
        writeFileSync(P, Buffer.from('Bud1\0\0\0\0finder junk\n', 'latin1'));
        write(IG, read(IG).replace('**/.DS_Store\n', ''));
      },
      // the pattern LINE, not the string: the comment block above it also says **/.DS_Store
      applied: () => read(P).startsWith('Bud1') && !/^\*\*\/\.DS_Store$/m.test(read(IG)) && read(IG).includes('**/.env.local\n'),
      predict: 'red exactly {DS-1 (7 patterns), DS-ign (member), DP#3 lib/.DS_Store unknown}, 532/510/3/19',
    });
  },
};
if (!M[which]) { console.error(`unknown mutant ${which}`); process.exit(2); }
M[which]();
