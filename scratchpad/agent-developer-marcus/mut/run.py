#!/usr/bin/env python3
"""AS-95 cycle-1 rework: mutation battery. Scratch copies only — the worktree is
never mutated. Each mutant asserts its edit applied before the suite runs."""
import os, shutil, subprocess, sys, re, json
SRC = '/Users/forrest/Code/american-software-company/.worktrees/AS-95/apps/chat'
MUT = '/Users/forrest/Code/american-software-company/scratchpad/agent-developer-marcus/mut'

W = 'watch/advance-watcher.mjs'
L = 'lib/loop-status.js'
P = 'public/loop-status.js'

MUTANTS = {
 'm-f1-no-retry': (W, """    if (loop === null) return; // an aborted MESSAGE fire: pre-loop behaviour, untouched
    pending = true; // keep the debt: the next poll retries""",
                      """    if (loop === null) return; // an aborted MESSAGE fire: pre-loop behaviour, untouched
    return; // MUTANT: the cycle-0 behaviour — the abort tells the loop nothing"""),
 'm-f1-unbounded': (W, """    if (at - waitingSince >= limits.maxLockWaitMs) {""",
                       """    if (false && at - waitingSince >= limits.maxLockWaitMs) {"""),
 'm-f1-noisy-retry': (W, """      if (waitingSince === null) log(`LOOP-FIRE tick ${loop ? loop.ticks + 1 : 1}`);""",
                         """      log(`LOOP-FIRE tick ${loop ? loop.ticks + 1 : 1}`);"""),
 'm-f2-no-hold': (W, """    resumeHold = true; // F2: wait out anything the dead process left running""",
                     """    resumeHold = false; // MUTANT"""),
 'm-f2-age-is-pid': (W, """    if (!held || !Number.isFinite(startedMs) || now() - startedMs >= resumeGraceMs) {""",
                        """    if (!held || !Number.isFinite(startedMs) || now() - startedMs >= 0) {"""),
 'm-f2-poll-order': (W, """  if (lockHeld) return 'wait-lock';\n""", ""),
 'm-f3-no-start-mirror': (W, """    // which is the exact symptom this task exists to remove.
    mirror();""",
                             """    // which is the exact symptom this task exists to remove."""),
 'm-f3-no-settle-mirror': (W, """      stop('error', { message: err.message });
    }
    mirror();""",
                              """      stop('error', { message: err.message });
    }"""),
 'm-f5-idle-between': (L, """  const betweenLoopTicks = tick === null && loop !== null && loop.active && w.listening;""",
                          """  const betweenLoopTicks = false;"""),
 'm-f5-no-heartbeat-guard': (L, """  const betweenLoopTicks = tick === null && loop !== null && loop.active && w.listening;""",
                                """  const betweenLoopTicks = tick === null && loop !== null && loop.active;"""),
 'm-f6-no-gap-detail': (P, """    parts.push('Between loop ticks: no tick holds the lock this instant, and the next one fires within a poll.');""",
                           """    parts.push('');"""),
}

def run(d):
    r = subprocess.run(['node','--test'], cwd=d, capture_output=True, text=True)
    out = r.stdout
    fails = sorted(set(re.findall(r'^✖ (.+?) \(\d', out, re.M)))
    m = re.search(r'^ℹ tests (\d+)', out, re.M); tests = m.group(1) if m else '?'
    m = re.search(r'^ℹ pass (\d+)', out, re.M); p = m.group(1) if m else '?'
    m = re.search(r'^ℹ fail (\d+)', out, re.M); f = m.group(1) if m else '?'
    return tests, p, f, fails

results = {}
names = sys.argv[1:] or list(MUTANTS)
for name in names:
    rel, old, new = MUTANTS[name]
    d = os.path.join(MUT, name)
    if os.path.exists(d): shutil.rmtree(d)
    shutil.copytree(SRC, d)
    path = os.path.join(d, rel)
    s = open(path).read()
    n = s.count(old)
    assert n == 1, f'{name}: anchor found {n} times — mutation NOT applied'
    open(path,'w').write(s.replace(old,new))
    after = open(path).read()
    assert after != s, f'{name}: file unchanged — mutation NOT applied'
    tests,p,f,fails = run(d)
    results[name] = {'tests':tests,'pass':p,'fail':f,'red':fails}
    print(f'{name}: {tests} tests, {p} pass, {f} fail -> {fails}')
open(os.path.join(MUT,'results.json'),'w').write(json.dumps(results, indent=1))
