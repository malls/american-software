# Plan: AS-21 — pass permission grants via --allowedTools/--disallowedTools in tickArgv()

Task: task_01M1A1X0XF2N6GX5302PRSHEZ6
Planner: agent:cto-owen (2026-08-30)
Branch: feat/AS-21-tickargv-permission-grants
Complexity: low

## Problem

Project-scope `.claude/settings.json` permission allowlists never load for
headless `claude -p` children — workspace trust is granted interactively and a
headless child never sees the dialog ("Ignoring 9 permissions.allow entries …
this workspace has not been trusted", tick log
`apps/chat/data/logs/tick-2026-08-30T19-14-54.450Z.log`). The 19:14:54Z tick
verified four explicitly-allowed commands all denied despite the committed
allowlist (65d567e). Board + orchestrator selected fix #2 from that tick's
analysis: pass the grants explicitly on the spawn argv.

## Design decision: read `.claude/settings.json` at fire time (option a)

Decided against hardcoding the rules in `tickArgv()` with a pointer comment
(option b). Rationale:

1. **Drift is the exact failure class that caused this bug.** Two artifacts
   asserting what is permitted (settings file vs. runtime) disagreed, and the
   disagreement cost four diagnostic ticks. Hardcoding recreates that split:
   the next person who edits `settings.json` must remember to edit
   `advance-watcher.mjs` too, and nothing fails loudly when they don't — the
   tick just silently lacks (or worse, keeps) a grant.
2. **The cost asymmetry is decisive.** The fire-time read is a `readFileSync`
   + `JSON.parse` + two optional-chained lookups inside a try/catch — under
   ten lines in the effectful shell, zero new dependencies. Option b saves
   none of that complexity; it only relocates the list.
3. **Fire-time (not watcher-startup) read means settings edits take effect on
   the next tick with no launchd bootout/bootstrap.** The restart dance is
   exactly the operational friction this saga has been paying down. The file
   is ~20 lines; per-fire cost is unmeasurable.
4. **The deny-list invariant becomes structural.** Allows and denies come from
   the same parse of the same file, so "allows passed but force-push denies
   dropped" cannot happen by construction. With a hardcoded copy that
   invariant is only conventional.

## Approach

Preserve the file's pure-core / effectful-shell architecture (header comment,
lines 24–28): `tickArgv()` stays pure; the file read is a separate, separately
testable function composed by `fire()`.

### 1. `loadPermissionRules(settingsPath)` — new export, `advance-watcher.mjs`

- `readFileSync(settingsPath, 'utf8')` + `JSON.parse` in a try/catch.
- Success → `{ allow: [...], deny: [...] }` from `permissions.allow` /
  `permissions.deny`, each defaulting to `[]` if absent; validate both are
  arrays of strings (filter non-strings).
- Missing file, unreadable, unparsable, or non-object → return `null`.
  **Never a hardcoded fallback copy of either list** — on `null` the caller
  logs and the tick fires with no extra grants (today's behavior, degraded
  not broken). Because both lists ride or fall together, a tick can never
  fire with allows but without the force-push denies.

### 2. `tickArgv(watcherPid, permissionMode, rules)` — extend the pure function

- Third parameter `rules = { allow: [], deny: [] }` (default keeps the
  zero-arg and two-arg calls backward compatible).
- Argv: existing six elements unchanged, then append
  `'--allowedTools', ...rules.allow` iff `allow.length > 0`, then
  `'--disallowedTools', ...rules.deny` iff `deny.length > 0`.
- Each rule is its own argv element: the flags are variadic ("comma or
  space-separated", verified against `claude --help` 2026-08-30), we spawn
  without a shell, and rules contain internal spaces (`Bash(git *)`). A
  variadic flag consumes args until the next `--flag`, so the two flag groups
  go last and denies terminate the array — no positional args follow.

### 3. `fire()` + `main()` wiring

- `paths.settings = join(config.repoRoot, '.claude', 'settings.json')`.
- In `fire()`, before spawn: `const rules = loadPermissionRules(paths.settings)`;
  if `null`, `log('WARN permission rules unavailable (…); firing without grants')`
  and pass the empty default. Spawn call becomes
  `tickArgv(process.pid, config.permissionMode, rules ?? undefined)`.
- Update the spawn-site comment block (lines 393–411) and the AS-20 comment
  above `tickArgv` to document the new transport.

### 4. Tests — `apps/chat/test/watcher.test.js`

The AS-20 pin test (line 332) asserts the exact argv array and must account
for dynamically-loaded rules — it keeps pinning exact arrays by *injecting*
rules, never by reading the repo's live settings file:

- No-rules calls (`tickArgv(4242, 'acceptEdits')`, `tickArgv()`) → the
  existing six-element arrays, unchanged (back-compat pin).
- With `rules = { allow: ['Bash(lattice *)', 'Bash(git *)'], deny:
  ['Bash(git push --force*)'] }` → exact ten-element array, flags in order,
  each rule its own element, denies last.
- `allow: []` with non-empty `deny` → `--disallowedTools` group only (and
  vice versa); both empty → the plain six-element array.
- `loadPermissionRules`: fixture settings file written to a per-test temp dir
  (pattern already used by the lock-ops tests): valid fixture → exact
  `{allow, deny}`; missing file → `null`; malformed JSON → `null`;
  `permissions` absent → `{allow: [], deny: []}`; non-string entries filtered.
- One composition assertion: rules loaded from the fixture fed through
  `tickArgv` produce the force-push deny rules as trailing argv elements —
  the methodology invariant, pinned.

### 5. Docs

- `apps/chat/watch/README.md:94` permission ladder: record that rung 1
  (project settings allowlist) is disproven for headless children with a
  pointer to the 19:14:54Z tick log, and that explicit `--allowedTools` /
  `--disallowedTools` flags (this task) are the operative rung.
  (App-level doc — not a top-level markdown file.)

## Files

- `apps/chat/watch/advance-watcher.mjs` — `loadPermissionRules` (new),
  `tickArgv` (extended), `fire()`/`main()` wiring, comment updates.
- `apps/chat/test/watcher.test.js` — pin-test extension + loader fixture tests.
- `apps/chat/watch/README.md` — ladder correction.

## Acceptance criteria

1. With the repo's committed `.claude/settings.json`, the spawned argv
   contains `--allowedTools` followed by exactly its 9 allow rules and
   `--disallowedTools` followed by exactly its 3 deny rules, each rule a
   single argv element, deny group last.
2. All three `git push --force*` deny rules appear whenever any allow rule
   does (structural — same parse; pinned by a test).
3. Settings file missing/unparsable → WARN logged, argv identical to today's
   six-element array; no hardcoded rule strings anywhere in the watcher.
4. Existing no-rules `tickArgv` calls produce byte-identical argv (back-compat).
5. `node --test apps/chat/test/` passes; no live-settings reads in tests
   (fixture files only).
6. Live verification (post-merge, outside this task's tests): next
   watcher-fired tick's log shows `lattice list` executing — the four
   denied commands from the 19:14:54Z tick are the regression check.

## Out of scope

- launchd plist changes, `ADVANCE_PERMISSION_MODE` (fix #3 rejected as
  default; unchanged).
- User-scope `~/.claude/settings.json` (fix #1 — the watcher must not write
  outside the repo).
- The #bizdev channel CLI work (AS-22).
