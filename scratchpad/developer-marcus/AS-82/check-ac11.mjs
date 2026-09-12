// AS-82 AC-11: the main() span must contain none of the effect identifiers.
// awk is not available to this session, so the same span/grep in node.
import { readFileSync } from 'node:fs';
const file = process.argv[2];
const lines = readFileSync(file, 'utf8').split('\n');
const start = lines.findIndex((l) => /^function main\(\)/.test(l));
if (start < 0) throw new Error('no main()');
let end = start;
while (end < lines.length && !/^\}/.test(lines[end])) end += 1;
const span = lines.slice(start, end + 1);
const re = /writeWatcherPid|acquireLock|releaseLock|spawn|decide\(|nextPollAction|setInterval|fireNonce/;
const hits = span.filter((l) => re.test(l));
console.log(`main() span: lines ${start + 1}..${end + 1} (${span.length} lines)`);
console.log(`AC-11 hits: ${hits.length}`);
for (const h of hits) console.log(`  ${h}`);
