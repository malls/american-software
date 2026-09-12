// M6 probe: extract parseDockerignore verbatim from the branch's test file (read-only) and
// feed it forms the strict contract should refuse or normalise. Never touches the worktree.
import { readFileSync } from 'node:fs';
const src = readFileSync('/Users/forrest/Code/american-software-company/.worktrees/AS-86/apps/chat/test/deploy-shape.test.js', 'utf8');
const fn = src.match(/function parseDockerignore\(text\) \{[\s\S]*?\n\}/)[0];
const parseDockerignore = new Function(fn + '\nreturn parseDockerignore;')();
const cases = [
  ['trailing slash', 'data/\n'],
  ['double trailing slash', 'data//\n'],
  ['CRLF', 'data/\r\nREADME.md\r\n'],
  ['leading whitespace', '   chat\n'],
  ['inline comment (Docker has none; literal pattern)', 'data/ # x\n'],
  ['dot-slash prefix ./lib (Docker Cleans to lib)', './lib\n'],
  ['parent traversal lib/../lib (Docker Cleans to lib)', 'lib/../lib\n'],
  ['dot alone (Docker: everything)', '.\n'],
  ['negation', '!lib\n'],
  ['star', 'public/*.map\n'],
  ['double star', '**/fixtures\n'],
  ['leading slash', '/data\n'],
  ['question', 'a?b\n'],
  ['bracket', 'a[0]\n'],
  ['comment only', '# just a comment\n'],
  ['empty file', ''],
  ['escaped star (BuildKit \\*)', 'a\\*b\n'],
];
console.log(`${cases.length} forms examined`);
for (const [name, text] of cases) {
  try { console.log(`ACCEPT  ${name.padEnd(52)} -> ${JSON.stringify(parseDockerignore(text))}`); }
  catch (e) { console.log(`THROW   ${name.padEnd(52)} -> ${e.message}`); }
}
