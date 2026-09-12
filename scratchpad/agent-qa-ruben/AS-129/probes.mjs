// AS-129 probes past the list (qa-ruben). Read-only over the worktree's
// exported module; every effect is injected. Prints one line per probe.
import {
  loadConfig, loopLimits, LOOP_DEFAULTS, DEFAULTS, MAX_TIMER_MS, makeLoopOps, capReached, workRemains, nextPollAction,
} from '/Users/forrest/Code/american-software-company/.worktrees/AS-129/apps/chat/watch/advance-watcher.mjs';

const T0 = Date.parse('2026-09-12T12:00:00.000Z');
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();
const out = (id, ok, msg) => console.log(`${ok ? 'ok ' : 'XX '} ${id}: ${msg}`);

function tryCfg(env) {
  try { return { value: loadConfig(env) }; } catch (e) { return { threw: e.message }; }
}

// --- P1: envMinutes ceiling at exact boundaries ------------------------------
{
  const exact = MAX_TIMER_MS / MIN; // 35791.394116666...
  const cases = [
    ['35791', 'accept'], ['35792', 'throw'], ['35791.394', 'accept'], ['35791.3942', 'throw'],
    [String(exact), 'accept'], ['1e4', 'accept'], ['1e5', 'throw'], ['0x10', 'accept'], [' 12 ', 'accept'],
    ['Infinity', 'fallback'], ['1e400', 'fallback'], ['NaN', 'fallback'], ['', 'fallback'], ['junk', 'fallback'],
    ['-1', 'fallback'], ['0', 'fallback'], ['-35792', 'fallback'], ['2147483647', 'throw'],
  ];
  for (const [raw, want] of cases) {
    const r = tryCfg({ ADVANCE_TICK_TIMEOUT_MIN: raw });
    const got = r.threw ? 'throw' : r.value.tickTimeoutMin === DEFAULTS.tickTimeoutMin && Number(raw) !== DEFAULTS.tickTimeoutMin ? 'fallback' : 'accept';
    out('P1', got === want, `ADVANCE_TICK_TIMEOUT_MIN=${JSON.stringify(raw)} -> ${got}${r.threw ? ` (${r.threw})` : ` value=${r.value.tickTimeoutMin}`} (want ${want})`);
  }
  // undefined env var (missing) falls back without throwing
  const r = tryCfg({});
  out('P1', !r.threw && r.value.tickTimeoutMin === 30, `missing var -> ${r.value?.tickTimeoutMin}`);
}

// --- P2: lock-wait derivation under env overrides -----------------------------
{
  const cfg = loadConfig({ ADVANCE_TICK_TIMEOUT_MIN: '90', ADVANCE_LOCK_STALE_MIN: '100', ADVANCE_LOOP_REARM_MIN: '2' });
  const l = loopLimits(cfg);
  out('P2', l.maxLockWaitMs === 190 * MIN && l.rearmMs === 2 * MIN, `90/100/2 -> maxLockWaitMs=${l.maxLockWaitMs} rearmMs=${l.rearmMs}`);
  const big = loopLimits(loadConfig({ ADVANCE_TICK_TIMEOUT_MIN: '35791', ADVANCE_LOCK_STALE_MIN: '35791' }));
  out('P2', big.maxLockWaitMs === 2 * 35791 * MIN, `35791/35791 -> maxLockWaitMs=${big.maxLockWaitMs} (> MAX_TIMER_MS ${big.maxLockWaitMs > MAX_TIMER_MS}; comparison-only use, see grep)`);
  const host = loopLimits(loadConfig({ ADVANCE_TICK_TIMEOUT_MIN: '60', ADVANCE_LOCK_STALE_MIN: '75' }));
  out('P2', host.maxLockWaitMs === 135 * MIN && host.rearmMs === 10 * MIN && host.maxTicks === 24 && host.maxMs === 8 * 60 * MIN, `host 60/75 -> ${JSON.stringify(host)}`);
  out('P2', Object.isFrozen(LOOP_DEFAULTS) && !Object.isFrozen(host), `LOOP_DEFAULTS frozen; loopLimits result is a fresh object`);
}

// --- harness ----------------------------------------------------------------
function harness({ board = { tasks: [{ id: 't1', status: 'review' }] }, state = null, lock = null, sentinel = null, highwater = null, limits = {} } = {}) {
  let now = T0;
  const lines = [];
  const saved = [];
  const ops = makeLoopOps({
    loadBoard: () => (typeof board === 'function' ? board() : board),
    loadSentinel: () => sentinel,
    loadHighwater: () => highwater,
    loadLock: () => (typeof lock === 'function' ? lock() : lock),
    loadState: () => state,
    saveState: (b) => saved.push(JSON.parse(JSON.stringify(b))),
    log: (l) => lines.push(l),
    now: () => now,
    limits: { ...LOOP_DEFAULTS, maxTicks: 2, rearmMs: 10 * MIN, ...limits },
    resumeGraceMs: 60 * MIN,
  });
  return { ops, lines, saved, advance: (ms) => { now += ms; }, now: () => now, l: (p) => lines.filter((x) => x.startsWith(p)) };
}
const okTick = () => ({ code: 0, signal: null, timedOut: false, headBefore: 'a', headAfter: 'b' });

// --- P3: re-arm due in the SAME poll as a fresh board message -----------------
{
  const h = harness();
  h.ops.start({ messageId: 5 }); h.ops.takeFire(); h.ops.settle(okTick()); h.ops.takeFire(); h.ops.settle(okTick());
  h.advance(10 * MIN);
  // poll(): decide() says 'fire' for message 9; then rearmIfDue(); then nextPollAction.
  const rearmed = h.ops.rearmIfDue();
  const next = nextPollAction({ decideAction: 'fire', loopPending: h.ops.pending(), deployPending: false, lockHeld: h.ops.blockedByLock() });
  // fire(sentinel 9) -> start({messageId: 9})
  h.ops.start({ messageId: 9 });
  const snap = h.ops.snapshot();
  const mirror = h.saved.at(-1);
  out('P3', rearmed && next === 'fire-message', `rearmIfDue=${rearmed}, nextPollAction=${next} (message wins the fire)`);
  out('P3', mirror.armedBy === 5, `OBSERVATION: loop armedBy=${mirror.armedBy} though message 9 fired it (start() is idempotent inside a live loop); pending=${snap.pending} (stale true, cleared at settle)`);
  out('P3', h.l('LOOP-REARM').length === 1 && h.l('LOOP-START').length === 1, `log: ${h.l('LOOP-REARM').length} LOOP-REARM, ${h.l('LOOP-START').length} LOOP-START (no second START for msg 9)`);
}

// --- P4: resume() with stale advance-loop.json shapes -------------------------
{
  // (a) active:true, ticks 23, startedAt 9h ago -> maxMs cap
  let h = harness({ state: { active: true, ticks: 23, startedAt: iso(T0 - 9 * 60 * MIN), armedBy: 3 }, limits: { maxTicks: 24 } });
  h.ops.resume();
  out('P4a', !h.ops.pending() && h.ops.snapshot().rearmAt === iso(T0 + 10 * MIN) && /reason=cap-hit/.test(h.l('LOOP-STOP')[0] ?? ''), `elapsed cap on resume -> pending=${h.ops.pending()} rearmAt=${h.ops.snapshot().rearmAt} stop=${h.l('LOOP-STOP')[0]}`);
  // (b) active:true AND rearmAt set (inconsistent): loop wins, rearmAt ignored
  h = harness({ state: { active: true, ticks: 1, startedAt: iso(T0 - MIN), armedBy: 3, rearmAt: iso(T0 - MIN) } });
  h.ops.resume();
  out('P4b', h.ops.active() && h.ops.snapshot().rearmAt === null && h.ops.pending(), `active+rearmAt -> active=${h.ops.active()} rearmAt=${h.ops.snapshot().rearmAt} pending=${h.ops.pending()} resumeHold=${h.ops.snapshot().resumeHold}`);
  // (c) active:false, rearmAt 3 days in the past, board now DRY -> re-arms at once, no work check
  h = harness({ state: { active: false, ticks: 0, armedBy: 3, rearmAt: iso(T0 - 3 * 24 * 60 * MIN) }, board: { tasks: [] } });
  h.ops.resume();
  const due = h.ops.rearmIfDue();
  out('P4c', due === true, `OBSERVATION: stale past rearmAt + dry board -> rearmIfDue=${due}, active=${h.ops.active()} pending=${h.ops.pending()} (one tick fires, then settle stops 'dry'; no workRemains re-check at re-arm)`);
  // (d) garbage rearmAt shapes are ignored
  for (const bad of ['garbage', '', null, undefined, 12345, {}]) {
    h = harness({ state: { active: false, ticks: 0, armedBy: 3, rearmAt: bad } });
    let threw = null; try { h.ops.resume(); } catch (e) { threw = e.message; }
    out('P4d', !threw && h.ops.snapshot().rearmAt === null && !h.ops.rearmIfDue(), `rearmAt=${JSON.stringify(bad)} -> ${threw ? 'THREW ' + threw : 'ignored'}`);
  }
  // (e) numeric rearmAt (ms) is NOT accepted (Date.parse('1757...') -> NaN); fine: mirror always writes ISO
  // (f) armedBy missing while cooling
  h = harness({ state: { active: false, rearmAt: iso(T0 + MIN) } });
  h.ops.resume(); h.advance(MIN); h.ops.rearmIfDue();
  out('P4f', h.ops.active() && h.saved.at(-1).armedBy === null, `missing armedBy -> re-armed loop armedBy=${h.saved.at(-1).armedBy}; log: ${h.l('LOOP-REARM')[0]}`);
  // (g) active:false, no rearmAt, lastLoop cap-hit (a mirror written by PRE-AS-129 code) -> nothing re-arms
  h = harness({ state: { active: false, ticks: 0, armedBy: 3, lastLoop: { reason: 'cap-hit', ticks: 24 } } });
  h.ops.resume(); h.advance(60 * MIN);
  out('P4g', !h.ops.rearmIfDue() && !h.ops.active(), `pre-AS-129 mirror (cap-hit, no rearmAt) -> no re-arm (the 11:21Z stop stays stopped until a message)`);
}

// --- P5: resumed cap-hit with an orphan tick still holding the lock (F2 seam) --
{
  // Watcher died mid-tick 24 with the loop past maxMs; relaunch; the orphan's lock is 2 min old (fresh).
  const lock = { pid: 99999, startedAt: iso(T0 - 2 * MIN), source: 'watcher', pidAlive: false };
  const h = harness({ state: { active: true, ticks: 23, startedAt: iso(T0 - 9 * 60 * MIN), armedBy: 3 }, limits: { maxTicks: 24 }, lock });
  h.ops.resume();
  h.advance(10 * MIN);
  const rearmed = h.ops.rearmIfDue();
  const held = h.ops.blockedByLock();
  const next = nextPollAction({ decideAction: 'idle', loopPending: h.ops.pending(), deployPending: false, lockHeld: held });
  out('P5', rearmed && next === 'fire-loop' && held === false, `RESIDUAL: resumed cap-hit -> cooldown -> re-arm: resumeHold=${h.ops.snapshot().resumeHold}, blockedByLock=${held}, nextPollAction=${next} while a 12-min-old lock (dead watcher pid, orphan tick may run to 60 min) is on disk — acquireLock's dead-pid steal then fires beside it (same exposure as the message path)`);
  // Contrast: the not-past-cap resume DOES hold.
  const h2 = harness({ state: { active: true, ticks: 1, startedAt: iso(T0 - MIN), armedBy: 3 }, limits: { maxTicks: 24 }, lock });
  h2.ops.resume();
  out('P5', h2.ops.blockedByLock() === true, `contrast: ordinary resume -> blockedByLock=${h2.ops.blockedByLock()} (F2 holds there)`);
}

// --- P6: cooldown boundaries and rearmMs edge values --------------------------
{
  let h = harness();
  h.ops.start({ messageId: 5 }); h.ops.takeFire(); h.ops.settle(okTick()); h.ops.takeFire(); h.ops.settle(okTick());
  h.advance(10 * MIN - 1);
  const a = h.ops.rearmIfDue(); h.advance(1); const b = h.ops.rearmIfDue();
  out('P6', a === false && b === true, `at-1ms=${a}, at=${b} (>= boundary)`);
  h = harness({ limits: { rearmMs: 0 } });
  h.ops.start({ messageId: 5 }); h.ops.takeFire(); h.ops.settle(okTick()); h.ops.takeFire(); h.ops.settle(okTick());
  out('P6', h.ops.rearmIfDue() === true, `rearmMs=0 -> re-arms on the next poll (cooldown is a >=, never a spin inside settle)`);
  // Re-armed loop that caps AGAIN with work -> second cooldown, armedBy preserved (steady state: 24 ticks, 10 min, 24 ticks ...)
  h = harness();
  h.ops.start({ messageId: 5 }); h.ops.takeFire(); h.ops.settle(okTick()); h.ops.takeFire(); h.ops.settle(okTick());
  h.advance(10 * MIN); h.ops.rearmIfDue(); h.ops.takeFire(); h.ops.settle(okTick()); h.ops.takeFire(); h.ops.settle(okTick());
  out('P6', h.l('LOOP-COOLDOWN').length === 2 && h.saved.at(-1).armedBy === 5 && h.saved.at(-1).rearmAt === iso(h.now() + 10 * MIN), `second cap -> second cooldown, armedBy=${h.saved.at(-1).armedBy}, rearmAt=${h.saved.at(-1).rearmAt}`);
  // no-progress inside the re-armed loop ends it for good (counters reset at re-arm)
  h = harness({ limits: { maxTicks: 5 } });
  const flat = () => ({ code: 0, signal: null, timedOut: false, headBefore: 'a', headAfter: 'a' });
  h.ops.start({ messageId: 5 });
  for (let i = 0; i < 5; i++) { h.ops.takeFire(); h.ops.settle(i < 3 ? okTick() : flat()); }
  out('P6', /reason=no-progress/.test(h.l('LOOP-STOP')[0] ?? '') && h.l('LOOP-COOLDOWN').length === 0, `two flat ticks -> ${h.l('LOOP-STOP')[0]?.slice(0, 40)}; cooldown lines=${h.l('LOOP-COOLDOWN').length}`);
}

// --- P7: settle() error path during a cooldown; stop() reasons other than cap-hit never cool down
{
  const h = harness({ board: () => { throw new Error('boom'); } });
  h.ops.start({ messageId: 5 }); h.ops.takeFire(); h.ops.settle(okTick());
  out('P7', /reason=error/.test(h.l('LOOP-STOP')[0] ?? '') && h.saved.at(-1).rearmAt === null, `loadBoard throws -> ${h.l('LOOP-STOP')[0]?.slice(0, 30)}, rearmAt=${h.saved.at(-1).rearmAt}`);
  // settle() with NO loop but a pending cooldown (a message tick fired outside the loop? not reachable: start() clears rearm). Mirror keeps rearmAt.
  const h2 = harness();
  h2.ops.start({ messageId: 5 }); h2.ops.takeFire(); h2.ops.settle(okTick()); h2.ops.takeFire(); h2.ops.settle(okTick());
  h2.ops.settle(okTick()); // a foreign tick settled with loop null
  out('P7', h2.saved.at(-1).rearmAt === iso(T0 + 10 * MIN) && h2.saved.at(-1).armedBy === 5, `settle with loop null keeps rearmAt=${h2.saved.at(-1).rearmAt} armedBy=${h2.saved.at(-1).armedBy}`);
}

// --- P8: capReached / workRemains edge shapes ----------------------------------
{
  out('P8', capReached({ ticks: 0, startedAt: T0 }, T0 + 8 * 60 * MIN) === true && capReached({ ticks: 0, startedAt: T0 }, T0 + 8 * 60 * MIN - 1) === false, `maxMs boundary is >=`);
  out('P8', capReached({ ticks: 24, startedAt: T0 }, T0) === true && capReached({ ticks: 23, startedAt: T0 }, T0) === false, `maxTicks boundary is >=`);
  out('P8', workRemains(null) === false && workRemains({}) === false && workRemains({ tasks: [{ id: 'a', status: 'blocked' }] }) === false, `null/{}/blocked-only -> false`);
  out('P8', workRemains({ tasks: [{ id: 'a', status: 'backlog', dependsOn: ['b'] }, { id: 'b', status: 'cancelled' }] }) === true, `backlog depending on a cancelled task -> ready -> true`);
  out('P8', workRemains({ tasks: [{ id: 'a', status: 'backlog', dependsOn: ['b'] }, { id: 'b', status: 'needs_human' }] }) === false, `backlog behind needs_human -> false`);
}
