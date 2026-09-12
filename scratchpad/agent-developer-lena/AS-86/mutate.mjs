// AS-86 mutation harness (developer-lena). Applies one named mutant in place,
// asserting it landed AT THE INTENDED SITE, or throws having changed nothing.
// Restore is the caller's `trap` (RESTORE below).
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const WT = '/Users/forrest/Code/american-software-company/.worktrees/AS-86';
const PAD = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-lena/AS-86';
const WATCHER = WT + '/apps/chat/watch/advance-watcher.mjs';
const DOCKERIGNORE = WT + '/apps/chat/.dockerignore';
const SHAPE = WT + '/apps/chat/test/deploy-shape.test.js';

const which = process.argv[2];

function sliceFn(src, name) {
  const start = src.indexOf('export function ' + name + '(');
  if (start < 0) throw new Error('function ' + name + ' not found');
  const end = src.indexOf('\n}\n', start);
  if (end < 0) throw new Error('end of ' + name + ' not found');
  return { start, end: end + 3, body: src.slice(start, end + 3) };
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

if (which === 'M1') {
  const src = readFileSync(WATCHER, 'utf8');
  const start = src.indexOf('export const IMAGE_INPUTS = Object.freeze([');
  if (start < 0) throw new Error('IMAGE_INPUTS anchor not found');
  const end = src.indexOf(']);', start);
  const block = src.slice(start, end);
  const mutated = block.replace("  '.dockerignore',\n", '');
  if (mutated === block) throw new Error('M1 DID NOT APPLY at the IMAGE_INPUTS site');
  const entries = (mutated.match(/^ {2}'/gm) || []).length;
  if (entries !== 9) throw new Error('M1: expected 9 entries, got ' + entries);
  writeFileSync(WATCHER, src.slice(0, start) + mutated + src.slice(end));
  console.log(`M1 applied at IMAGE_INPUTS (line ${lineOf(src, start)}); entries 10 -> ${entries}`);
} else if (which === 'M2') {
  const src = readFileSync(WATCHER, 'utf8');
  const fn = sliceFn(src, 'classifyImagePaths');
  const target = '    else unclassified.push(p);';
  if (!fn.body.includes(target)) throw new Error('M2: target line not inside classifyImagePaths');
  const occurrences = src.split(target).length - 1;
  if (occurrences !== 1) throw new Error('M2: target line appears ' + occurrences + ' times in the file; not unique');
  const mutatedBody = fn.body.replace(target, '    else declared.push(p);');
  writeFileSync(WATCHER, src.slice(0, fn.start) + mutatedBody + src.slice(fn.end));
  console.log(`M2 applied INSIDE classifyImagePaths (function at line ${lineOf(src, fn.start)}, target line ${lineOf(src, src.indexOf(target))})`);
} else if (which === 'M3') {
  const src = readFileSync(WATCHER, 'utf8');
  const anchor = src.indexOf('export function makeDeployOps(');
  if (anchor < 0) throw new Error('makeDeployOps not found');
  const target = '  const paths = IMAGE_INPUTS.map((p) => `apps/chat/${p}`);';
  const at = src.indexOf(target, anchor);
  if (at < 0) throw new Error('M3: `const paths =` line not found after makeDeployOps');
  if (src.indexOf(target) !== at) throw new Error('M3: the target line also occurs before makeDeployOps');
  const replacement = '  const paths = IMAGE_INPUTS.slice(0, 9).map((p) => `apps/chat/${p}`);';
  writeFileSync(WATCHER, src.slice(0, at) + replacement + src.slice(at + target.length));
  console.log(`M3 applied at the \`const paths =\` line ${lineOf(src, at)}, inside makeDeployOps (line ${lineOf(src, anchor)})`);
} else if (which === 'M4') {
  const src = readFileSync(DOCKERIGNORE, 'utf8');
  if (src.includes('test/fixtures')) throw new Error('M4: already present');
  const lines = src.split('\n');
  const at = lines.indexOf('chat');
  if (at < 0) throw new Error('M4: anchor line `chat` not found');
  lines.splice(at + 1, 0, 'test/fixtures');
  writeFileSync(DOCKERIGNORE, lines.join('\n'));
  if (!/^test\/fixtures$/m.test(readFileSync(DOCKERIGNORE, 'utf8'))) throw new Error('M4 DID NOT APPLY');
  console.log(`M4 applied to .dockerignore at line ${at + 2}: added pattern "test/fixtures"`);
} else if (which === 'M5') {
  // Unnamed probe (M6): is the README-only negative control discriminating, or
  // would it pass no matter what? Make README.md an image input; the control
  // must go red.
  const src = readFileSync(WATCHER, 'utf8');
  const start = src.indexOf('export const IMAGE_INPUTS = Object.freeze([');
  const end = src.indexOf(']);', start);
  const block = src.slice(start, end);
  const mutated = block.replace("  '.dockerignore',\n", "  '.dockerignore',\n  'README.md',\n");
  if (mutated === block) throw new Error('M5 DID NOT APPLY at the IMAGE_INPUTS site');
  const entries = (mutated.match(/^ {2}'/gm) || []).length;
  if (entries !== 11) throw new Error('M5: expected 11 entries, got ' + entries);
  writeFileSync(WATCHER, src.slice(0, start) + mutated + src.slice(end));
  console.log(`M5 applied at IMAGE_INPUTS (line ${lineOf(src, start)}); entries 10 -> ${entries}`);
} else if (which === 'M6') {
  // Criterion 8's own falsifier, done without disturbing cardinality: the
  // digest covers README.md in place of Dockerfile, so a README-only commit
  // MUST move the id and the negative control must go red at its own assertion
  // (M5 died earlier, at the stub count, and proved nothing about the control).
  const src = readFileSync(WATCHER, 'utf8');
  const anchor = src.indexOf('export function makeDeployOps(');
  const target = '  const paths = IMAGE_INPUTS.map((p) => `apps/chat/${p}`);';
  const at = src.indexOf(target, anchor);
  if (at < 0) throw new Error('M6: `const paths =` line not found after makeDeployOps');
  if (src.indexOf(target) !== at) throw new Error('M6: the target line also occurs before makeDeployOps');
  const replacement =
    "  const paths = IMAGE_INPUTS.map((p) => `apps/chat/${p === 'Dockerfile' ? 'README.md' : p}`);";
  writeFileSync(WATCHER, src.slice(0, at) + replacement + src.slice(at + target.length));
  console.log(`M6 applied at the \`const paths =\` line ${lineOf(src, at)}, inside makeDeployOps (line ${lineOf(src, anchor)})`);
} else if (which === 'M7') {
  // Criterion 7's falsifier: make parseDockerignore SHRUG at globs instead of
  // throwing. The six-form throws test must go red.
  const src = readFileSync(SHAPE, 'utf8');
  const target = '    if (/[*?[\\]]/.test(line)) throw new Error(`.dockerignore: glob unsupported: ${line}`);';
  const occurrences = src.split(target).length - 1;
  if (occurrences !== 1) throw new Error('M7: target line appears ' + occurrences + ' times');
  const fnStart = src.indexOf('function parseDockerignore(text) {');
  const at = src.indexOf(target);
  if (fnStart < 0 || at < fnStart) throw new Error('M7: target is not inside parseDockerignore');
  writeFileSync(SHAPE, src.replace(target, '    if (false) throw new Error(`.dockerignore: glob unsupported: ${line}`);'));
  console.log(`M7 applied INSIDE parseDockerignore (function line ${lineOf(src, fnStart)}, target line ${lineOf(src, at)})`);
} else if (which === 'BACKUP') {
  copyFileSync(WATCHER, PAD + '/watcher.bak');
  copyFileSync(DOCKERIGNORE, PAD + '/dockerignore.bak');
  copyFileSync(SHAPE, PAD + '/deploy-shape.bak');
  console.log('backed up');
} else if (which === 'RESTORE') {
  copyFileSync(PAD + '/watcher.bak', WATCHER);
  copyFileSync(PAD + '/dockerignore.bak', DOCKERIGNORE);
  copyFileSync(PAD + '/deploy-shape.bak', SHAPE);
  console.log('restored');
} else {
  throw new Error('unknown mutant: ' + which);
}
