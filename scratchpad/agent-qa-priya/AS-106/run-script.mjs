// qa-priya AS-106 review helper: invoke the branch's compose-run.mjs with docker by absolute path,
// capture its full stdout+stderr (the receipt) to a file, print it, and print the exit code.
// usage: node run-script.mjs <receipt-file> <script args...>
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [receiptFile, ...args] = process.argv.slice(2);
const SCRIPT = '/Users/forrest/Code/american-software-company/.worktrees/AS-106/apps/chat/bin/compose-run.mjs';
const r = spawnSync(process.execPath, [SCRIPT, ...args], {
  encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  env: { ...process.env, ADVANCE_DOCKER_BIN: '/usr/local/bin/docker', FORCE_COLOR: '0' },
});
const out = `${r.stdout || ''}${r.stderr ? `\n--- stderr ---\n${r.stderr}` : ''}\nscript exit=${r.status} signal=${r.signal}\n`;
writeFileSync(receiptFile, out);
process.stdout.write(out);
