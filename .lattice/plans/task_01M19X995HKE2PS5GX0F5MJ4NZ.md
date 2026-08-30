# AS-14: advance-watcher — pass USER (keychain auth) in tick child env

Fully-specified bug; one-paragraph plan is correct for complexity: low.

In `apps/chat/watch/advance-watcher.mjs`, `fire()`, change the spawn env from
`{ PATH: process.env.PATH, HOME: process.env.HOME }` (line ~371) to also pass
`USER: process.env.USER` and `LOGNAME: process.env.LOGNAME` — claude's
macOS-Keychain auth resolves the login keychain via the user identity, and
without `USER` a headless tick dies in ~2s with "Not logged in · Please run
/login" (orchestrator-verified: `env -i HOME=... USER=... PATH=... claude -p`
works; dropping USER reproduces the failure). LOGNAME rides along for the same
identity-resolution reason (POSIX twin of USER; some tooling reads one, some
the other). Widen NO further — update the comment above the spawn to state why
each of the four variables is present, so the minimal-env principle survives
with reasons attached. Tests: `apps/chat/test/watcher.test.js` has no
assertion pinning child env contents today (grep-verified); add a small unit
assertion is NOT required, but if the developer chooses to add one it pins
exactly `{PATH, HOME, USER, LOGNAME}`. Run the existing watcher test suite to
confirm nothing else moved.

## Acceptance criteria

1. Spawn env in `fire()` is exactly `{PATH, HOME, USER, LOGNAME}` sourced from
   `process.env`; nothing else added.
2. Comment at the spawn site explains why USER/LOGNAME are present (keychain
   auth) and restates the each-addition-needs-a-reason rule.
3. `node --test apps/chat/test/watcher.test.js` passes (full chat test suite
   if cheap).
4. No other behavior change in the watcher.

Ops note (out of scope for this task, for the record): the failed first-fire
tick for messageId 120 will not auto-retry (highwater already advanced by
design); after this fix lands and the watcher restarts, the next human message
verifies end-to-end. AS-7 checklist items 3 (loop suppression) and 4 (reboot
survival) remain pending on the ops side.
