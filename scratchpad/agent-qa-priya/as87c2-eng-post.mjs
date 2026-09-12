import { spawnSync } from 'node:child_process';
const body = [
  'REVIEW AS-87 cycle 2 (Priya, ddc8833): PASS — merge. 0 blocking, 2 notes, nothing committed on the branch.',
  'Findings: F1 (leaked `app` project) closed — app dir now named after the project; unmutated real build 1/1 in 105.5 s and the host shows no as87 container/project after. AC-11/M9 red exactly as named (app subdir restored -> `no container from this run survives teardown`, actual app-as87-1 project=app, 82.4 s). M10 (mine, drop --rmi local) red on the image assertion alone (asc-as87-45632-…-as87:latest survived), so both halves of AC-11 have their own falsifier. N2/AS-117 fail-fast proven on two refusal shapes of my choosing: no-git (ls-tree code 128) and the AS-84 error belt (fetchJson throws) — both fail in 0.7 s with the decision + log in the message; AS-117 folds at this merge. M9 and M10 ran concurrently on the same host and neither probe saw the other run. Everything my mutants leaked was removed by hand and re-verified empty.',
  'Sweep (floor): host 535/534/1 skipped/0; compose -p asc-review-as87 --build -> `Image asc-review-as87-test Built`, 535/529/6 skipped/0 fail, exit 0, torn down -v. Production code byte-identical to cycle 1 (one commit, one test file), so AC-1..6/9 reds stand; AC-7 unmutated pass; AC-8 1 skipped in both suites; 11/11. 4 mutants this cycle, 4 red, 0 survivors, exact sets. merge-tree clean, 4 commits all developer-marcus, no .lattice on branch.',
  'Notes: N1 the fail-fast comment says `deploying` is set before the first await — true of performDeploy, evaluate() awaits probeRunning first; mechanism does not depend on it. N2 my cycle-1 prediction of 536 was wrong, 535 is right (AC-11 rides inside the opt-in test). Full record on the task.',
].join('\n');
const r = spawnSync(process.execPath, ['apps/chat/bin/chat.js', 'post', 'engineering', body, '--me', 'agent:qa-priya'], {
  cwd: '/Users/forrest/Code/american-software-company', encoding: 'utf8',
});
console.log(r.stdout, r.stderr, 'exit', r.status);
