# AS-94: supervise the Lattice dashboard (:8799) under launchd so tailnet :8443 deep links answer without a live session

Plan by `agent:cto-owen`, 2026-09-10 (watcher-fired tick, planning stage). Implementer: `agent:developer-lena`. Reviewer: a QA who did not implement (`agent:qa-priya` or `agent:qa-ruben`, orchestrator's pick).
The task description (`lattice show AS-94`) carries WHAT/WHY, the five CTO decisions, AC-1..AC-6, and two later CTO comments (binding 1: the plist declares 8799; binding 2: the README names the three legs of the port coupling). This file is the HOW, and it **overrides the description where §8 says so**. Complexity: **low-to-medium** — four small artifacts; the work is in proving them and in the host handoff.

Branch `feat/AS-94-dashboard-launchd`, worktree `.worktrees/AS-94/`. Below, `$M` = `/Users/forrest/Code/american-software-company` (main checkout, pinned to master) and `$W` = `$M/.worktrees/AS-94`. Use `git -C $W …` for worktree work; **never `cd` into `$W` before a `lattice` call** (CLAUDE.md working-directory hazard). Scratchpad is per actor: implementer writes under `scratchpad/developer-lena/`, reviewer under `scratchpad/agent-qa-<name>/`, nothing at the scratchpad root (M3).

**This task does not install anything.** It ends in `needs_human` with the exact host commands (§7). Anyone — implementer, reviewer, orchestrator — who runs `launchctl bootstrap/bootout`, `tailscale`, `kill`, or starts a dashboard from inside a tick has left the plan.

---

## §0. Ground truth (verified 2026-09-10 against master `2c4d6d1`, read-only)

| Claim | Verified |
|---|---|
| The watcher precedent: template + sed recipe + Install/Uninstall/Restart sections | `apps/chat/watch/com.american-software.advance-watcher.plist.template` (52 lines: Label, ProgramArguments, WorkingDirectory, RunAtLoad `<true/>`, KeepAlive `<true/>`, EnvironmentVariables{PATH, ADVANCE_REPO_ROOT}, StandardOut/ErrorPath under `apps/chat/data/logs/`); recipe at `apps/chat/watch/README.md:135-151` (three `sed -e "s\|__X__\|…\|g"` expressions over `__REPO_ROOT__`, `__NODE_BIN__`, `__PATH__`), uninstall/restart at `:157-163`, "After any change… restart it" at `:165-179`. |
| **No test lints either plist today.** | `grep -ln plist apps/chat/test/*` → nothing. `watcher.test.js` imports decision logic only. AC-2's guard is new ground, not an extension. |
| The template will ride into the test image without any Dockerfile/compose change | `Dockerfile:17` `COPY watch ./watch`; `.dockerignore` lists `README.md` (root-anchored — `watch/README.md` is **not** ignored) and no `*.template` pattern. So a `node --test` file can `readFileSync('../watch/<template>')` and `'../watch/README.md'` inside the mountless container. `IMAGE_INPUTS` already contains `watch`, so the AS-75 deploy digest sees the new file with no watcher change. |
| The house pattern for "assert a manifest as data, strict parser that throws rather than shrugs" | `apps/chat/test/deploy-shape.test.js` (header comment, `parseComposeServices`, `parseCopySources`, and the "throws on forms it does not understand" test at `:313`). **Copy that shape, not its code.** |
| The lattice binary | `/Users/forrest/.local/bin/lattice` exists; it is a **symlink** into `/Users/forrest/.local/pipx/venvs/lattice-tracker/bin/lattice` (revealed by the sandbox's resolved-path message). The plist uses the **symlink** path: it survives a pipx reinstall/upgrade, the venv path may not. The venv script's shebang carries an absolute python path, so the job needs no `python` on `PATH`. |
| 8799 is the CLI's own default port | CTO comment 2, verified last tick against `lattice/cli/dashboard_cmd.py:49` (`default=8799`) and `lattice restart` `:143`. This plan re-verified nothing there (`lattice dashboard --help` is outside the tick allowlist) and needs nothing more: **the plist passes `--host 127.0.0.1 --port 8799` explicitly regardless of defaults** — declared, not ambient. |
| Something answers on 8799 now | `node -e fetch('http://127.0.0.1:8799/')` → **200**. |
| **Who holds it is NOT the process the description names.** | `pgrep -fl 'lattice dashboard'` → **two** processes: `52536 … lattice dashboard` (no `--host/--port` args → CLI defaults → this is the one on 8799) and `78002 … lattice dashboard --port 8805` (answers 200 on 8805; a second, unrelated dashboard). The description's pid 37867 (`--host 127.0.0.1 --port 8799`) is gone. Consequence for AC-4/§7: the pre-bootstrap step must identify the port owner by **port**, not by pid or argv — `lsof -nP -iTCP:8799 -sTCP:LISTEN` — and must not tell the operator to kill "the" dashboard, because there are two and only one is in the way. |
| Tick allowlist has none of `plutil`, `launchctl`, `pgrep`, `lsof` | `grep -n "plutil\|launchctl\|pgrep\|lsof" .claude/settings.json` → nothing. So **the node guard is the only AC-1/AC-2 mechanism that runs inside a tick**; `plutil -lint` is a host-shell observation (live session or the board at bootstrap). §5 splits the falsifiers accordingly. |
| Logs directory exists on the host | `apps/chat/data/logs/` (gitignored under `data/`) already holds the watcher's `launchd.{out,err}.log`. launchd creates log **files** but not directories; the recipe still `mkdir -p`s it so a fresh checkout does not crash-loop on a missing path. |
| Chat README section to amend | `apps/chat/README.md:167-210` "Links to Lattice (AS-10, host inference AS-93)"; the sentence to replace is `:205-210` ("run `lattice dashboard` to make them resolve … Making it survive without a live session is AS-94."). `apps/chat/README.md` and `apps/chat/watch/README.md` are app documentation, **not** top-level metawork files — the implementer edits them directly (AS-91/AS-93 precedent). No CLAUDE.md change is needed by this task. |

**Not verifiable from a tick, recorded as such (time-box expired, default answers applied):**

- `~/Library/LaunchAgents/` contents — the sandbox refused the listing. Default assumption: it holds the watcher plist and no `com.american-software.lattice-dashboard.plist`; §7's bootstrap sequence starts with `ls` so the operator sees the truth before acting.
- **Tailscale serve persistence across reboot** (the description's parked assumption; CTO comment 1 set the default to "assume yes"). `tailscale serve status` is a host action. **Default applied: yes, it persists** — Tailscale `serve` config is stored by tailscaled and re-applied at start; that is the product's documented behaviour, not something this repo can assert. §7 asks the operator to run `tailscale serve status` in the same host session and quote it. If the mapping is absent after a reboot, that is a **separate host record**, not an amendment to this task.

---

## §1. Scope and non-goals

**In scope (four deliverables, all under `apps/chat/`):**

1. `apps/chat/watch/com.american-software.lattice-dashboard.plist.template` — the launchd job, with placeholders (§2).
2. `apps/chat/test/launchd-plist.test.js` — the guard: renders every template under `watch/` with fixed placeholder values and asserts the properties (§3). Runs in the compose suite.
3. `apps/chat/watch/README.md` — a new "Lattice dashboard (AS-94)" section mirroring the watcher's Install / Uninstall-restart / After-any-change / Troubleshooting structure, plus the three-legged port block (§4).
4. `apps/chat/README.md` "Links to Lattice" — replace the "run `lattice dashboard`" sentence with the supervised service, keep the AS-10 not-in-compose rationale (§4).

Then the `needs_human` handoff (§7).

**Out of scope, per the description — do not drift into these:** containerizing the dashboard (AS-10 stands); making the Tailscale serve mapping a repo artifact (naming it in prose is not importing it); a sidebar liveness indicator for the dashboard; unifying the port across legs (AS-96 was **cancelled** by the board today — DM msg 632 — the port question moved upstream to the Lattice project; so the plist declares `8799` plainly and the README states the three legs as a fact, not as something this repo will unify); touching the watcher's own template or `advance-watcher.mjs` (the guard *reads* the watcher template; it does not change it); the second dashboard on 8805 (not ours; leave it alone).

---

## §2. The template — `apps/chat/watch/com.american-software.lattice-dashboard.plist.template` (new)

Same skeleton as the watcher template, same comment-header convention, three placeholders:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!--
  AS-94 Lattice dashboard launchd template. Render before installing:
    __REPO_ROOT__    absolute path to the MAIN checkout (pinned to master; no trailing
                     slash). The dashboard finds .lattice/ by walking up from its cwd,
                     so WorkingDirectory must be the repo root.
    __LATTICE_BIN__  absolute path to the lattice CLI (`command -v lattice`; the pipx
                     symlink /Users/<you>/.local/bin/lattice, not the venv path)
    __PATH__         PATH for the job; must contain the directory holding `lattice`
                     (launchd's default env is thin — do not omit this)
  This job is the ONE owner of 127.0.0.1:8799. Bind stays loopback: tailnet reach is
  Tailscale serve (:8443 -> 127.0.0.1:8799) only — never 0.0.0.0. Guarded by
  test/launchd-plist.test.js. Install/uninstall/restart: ./README.md, "Lattice dashboard".
-->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.american-software.lattice-dashboard</string>

  <key>ProgramArguments</key>
  <array>
    <string>__LATTICE_BIN__</string>
    <string>dashboard</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>8799</string>
  </array>

  <key>WorkingDirectory</key>
  <string>__REPO_ROOT__</string>

  <!-- Survives reboot (RunAtLoad) and crashes (KeepAlive). -->
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>__PATH__</string>
  </dict>

  <key>StandardOutPath</key>
  <string>__REPO_ROOT__/apps/chat/data/logs/lattice-dashboard.out.log</string>
  <key>StandardErrorPath</key>
  <string>__REPO_ROOT__/apps/chat/data/logs/lattice-dashboard.err.log</string>
</dict>
</plist>
```

Decisions baked in, so nobody re-derives them:

- **`--host 127.0.0.1 --port 8799` are explicit** even though both are the CLI defaults (§0). The whole point of this task per CTO binding 1 is that the port is declared by a committed artifact under a guard.
- **`KeepAlive` is the bare `<true/>`**, matching the watcher: relaunch on any exit, including a clean one. That is what makes AC-3's kill test pass, and it is also why a stale process on 8799 makes this job crash-loop at launchd's default throttle (~10 s) — hence §7's "stop the live-session dashboard first". Do not add `ThrottleInterval`; the default is fine and one fewer knob to explain.
- **No `ADVANCE_*` env** — the dashboard is not the watcher; a copied `ADVANCE_REPO_ROOT` would be a lie that the guard's "no unexpected keys" assertion catches.
- **Log names are the description's fixed ones** (`lattice-dashboard.out.log` / `.err.log`, under `apps/chat/data/logs/`). They do not collide with the watcher's `launchd.{out,err}.log`.
- **Label prefix `com.american-software.` and label = template basename** (`com.american-software.lattice-dashboard`), same rule the watcher follows; the guard enforces it for every template in the directory.

---

## §3. The guard — `apps/chat/test/launchd-plist.test.js` (new)

**How it runs where.** The template and `watch/README.md` are repo files COPY'd into the image (§0), so this is an ordinary `node --test` file in the compose suite; it renders with **fixed placeholder values** (`/checkout`, `/opt/lattice/bin/lattice`, `/opt/lattice/bin:/usr/bin:/bin`) and never touches the host, launchd, or a real path. `plutil` is **not** used here (it is macOS-only and not allowlisted); the file's own strict reader is the in-suite well-formedness check, and `plutil -lint` is the host-side half (§5, §7).

**Structure, in the deploy-shape idiom** — header comment saying why the file exists (no test lints the templates; a template that rendered to nonsense would still "pass" every other test), zero deps, strict parser that throws:

- `renderTemplate(text, values)` — the exact substitution the README's `sed` performs: for each `[name, value]`, replace every `__NAME__` with the value. **Assert after rendering that `/__[A-Z_]+__/` matches nothing** — a placeholder the recipe did not know about is the drift this guard exists to catch.
- `placeholdersOf(text)` — the set of `__NAME__` tokens in the raw template.
- `parseFlatPlist(text)` — a deliberately narrow plist reader: one top-level `<dict>`; `<key>` followed by exactly one of `<string>`, `<true/>`, `<false/>`, `<array>` of `<string>`s, or a one-level `<dict>` of `<key>/<string>` pairs. XML comments and the prolog/DOCTYPE are stripped first. **Throws** on: a `<key>` without a value, a value without a key, a nested `<array>`/`<dict>` inside an array, any tag other than those listed, an unclosed `<array>`/`<dict>`/`<plist>`, or trailing content after `</plist>`. Returns a plain object. The parser is discriminating only if it also parses the two real templates — which the tests below establish.
- `sedPlaceholdersFor(readme, label)` — from `watch/README.md`, take the fenced `sh` block that contains `$LABEL.plist.template` for the given `LABEL=<label>` assignment and return the set of `__NAME__` tokens that appear as the left side of a `sed -e "s|__NAME__|…|g"` expression. Throws if no such block is found (a missing recipe must not read as "zero placeholders, all consistent").

**Tests (exact titles matter — §5 matches mutants against them):**

- **T1** `'launchd: AS-94 — every plist template under watch/ renders clean and carries the common job shape'`
  `readdirSync('../watch')` filtered to `*.plist.template`, **cardinality asserted first: exactly 2** (`advance-watcher`, `lattice-dashboard`) with the names in the message. For each: render with fixed values for *all four placeholder names known across the directory* (`__REPO_ROOT__`, `__NODE_BIN__`, `__LATTICE_BIN__`, `__PATH__` — each template uses a subset; rendering with the superset is fine, the leftover check is what bites), no leftover placeholder, parse succeeds, `Label === 'com.american-software.' + basename-without-suffix`, `RunAtLoad === true`, `KeepAlive === true`, `WorkingDirectory === '/checkout'`, both `StandardOutPath`/`StandardErrorPath` start with `'/checkout/apps/chat/data/logs/'` and end with `.log`, `EnvironmentVariables.PATH` is a non-empty string. Report the count examined in every assertion message.
- **T2** `'launchd: AS-94 — the dashboard job binds loopback :8799 from the repo root, exactly'`
  On the rendered dashboard template: `assert.deepEqual(plist.ProgramArguments, ['/opt/lattice/bin/lattice', 'dashboard', '--host', '127.0.0.1', '--port', '8799'])` — **exact array equality, order included**; `WorkingDirectory === '/checkout'`; `Label === 'com.american-software.lattice-dashboard'`; `StandardOutPath === '/checkout/apps/chat/data/logs/lattice-dashboard.out.log'` and `.err.log` likewise; `assert.deepEqual(Object.keys(plist.EnvironmentVariables), ['PATH'])` (no copied `ADVANCE_*` keys); and the raw template's placeholder set is exactly `{__REPO_ROOT__, __LATTICE_BIN__, __PATH__}`. Include the assertion message `'bind stays 127.0.0.1 — tailnet reach is Tailscale serve only (CTO decision 1)'` on the ProgramArguments line so a red reads as policy, not typo.
- **T3** `'launchd: AS-94 — the README install recipe substitutes exactly each template\'s placeholders'`
  For each of the two labels, `sedPlaceholdersFor(readme, label)` set-equals `placeholdersOf(template)`. Cardinality: 2 recipes found. This is the AC-1 coupling stated as a property: the recipe and the template cannot drift apart silently.
- **T4** `'launchd: AS-94 — the plist reader throws on forms it does not understand'`
  ≥ 6 named malformed inputs (`<key>` with no value, `<integer>` value, nested `<array>`, unclosed `<array>`, a `<dict>` inside an array, text after `</plist>`), `assert.throws(…, /plist:/)` each, count asserted; then a positive parse of a minimal well-formed dict so "everything throws" is not what passes.

Projected: ~180 lines. **Nothing else in the suite changes.** Expected `# tests` on the branch = baseline measured on the branch tip **+ 4**.

---

## §4. Documentation

### 4.1 `apps/chat/watch/README.md` — new section, mirrored to the watcher's

Insert a new top-level section **between "Uninstall / restart" (+ its "After any change" subsection, ends `:179`) and "Permission modes" (`:181`)**, titled `## Lattice dashboard (AS-94) — the second launchd job in this directory`. Keep its subsection headings **identical in wording and order** to the watcher's so review can diff them side by side (AC-5): `### Prerequisites`, `### Install (launchd)`, `### Uninstall / restart`, `### After any change to the dashboard: `lattice restart``, `### Troubleshooting`, plus one extra `### The port is a three-legged coupling` (CTO binding 2). Also add two rows to the **Files** table (`:34-44`): `logs/lattice-dashboard.out.log` / `.err.log` | launchd | dashboard stdout/stderr (AS-94).

Content outline, with the sentences that carry the acceptance criteria written out:

**Opening paragraph.** Why a second job: AS-93's deep links are only live while something listens on `127.0.0.1:8799`; before AS-94 that was a hand-started process inside a Claude Code session. Same category decision as AS-10 (vendor tooling shipped with the pipx Lattice CLI, like `git`) → same supervision answer as the watcher, not compose. **This job is the ONE owner of :8799. Do not run `lattice dashboard` beside it** — the second copy fails to bind (AC-4; quote the observed error once §7 records it, e.g. `Address already in use`), and if it is the *first* copy that is stray, the launchd job crash-loops behind it. Bind is loopback only; the tailnet reaches it through Tailscale serve, which is Tailscale-authenticated — never change the host to `0.0.0.0` (the guard goes red if you do).

**Prerequisites.** `command -v lattice` resolves (the pipx symlink); the main checkout is on `master` (the dashboard reads `.lattice/` from `WorkingDirectory`). No `node` needed.

**Install (launchd)** — the recipe. Must use the same three-line `sed` shape as the watcher's so T3 can read it, and carries the two pre-steps:

```sh
REPO_ROOT="$(git rev-parse --show-toplevel)"   # run from inside the MAIN checkout (master)
LATTICE_BIN="$(command -v lattice)"            # e.g. /Users/<you>/.local/bin/lattice (pipx symlink)
LABEL=com.american-software.lattice-dashboard

# 1. Nothing else may hold 127.0.0.1:8799 — a live-session dashboard here makes the job crash-loop.
lsof -nP -iTCP:8799 -sTCP:LISTEN               # if it lists a PID, that is the process to stop
pgrep -fl 'lattice dashboard'                  # all dashboards, on ANY port — kill only the :8799 owner
# kill <pid-from-lsof>                         # then re-run lsof: it must print nothing

# 2. Render, lint, install.
mkdir -p "$REPO_ROOT/apps/chat/data/logs"
sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" \
    -e "s|__LATTICE_BIN__|$LATTICE_BIN|g" \
    -e "s|__PATH__|$(dirname "$LATTICE_BIN"):/usr/bin:/bin|g" \
    "$REPO_ROOT/apps/chat/watch/$LABEL.plist.template" \
    > ~/Library/LaunchAgents/$LABEL.plist
plutil -lint ~/Library/LaunchAgents/$LABEL.plist   # must print "OK"

launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/$LABEL.plist
launchctl print gui/$(id -u)/$LABEL | head -20      # state = running
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8799/   # 200
```

**Uninstall / restart** — mirror the watcher's three lines (`launchctl bootout …`, `rm ~/Library/LaunchAgents/$LABEL.plist`, "restart = bootout, then bootstrap again"), then the difference: **you rarely need bootout to bounce it** — `lattice restart` (from the repo root, defaults to :8799) sends the dashboard SIGHUP for a graceful restart; if the process exits instead, `KeepAlive` relaunches it. `launchctl kickstart -k gui/$(id -u)/$LABEL` is the launchd-native equivalent.

**After any change to the dashboard: `lattice restart`.** Mirror of the watcher's "After any change" paragraph: the dashboard is a long-lived host process; a Lattice CLI upgrade (`pipx upgrade`) or a template change takes effect only on restart; template change = re-render + bootout/bootstrap (host action for the board or a live session — a headless tick has no `launchctl` reach, same as the watcher).

**Troubleshooting** — table/bullets in the watcher's style: *`launchctl print` shows repeated non-zero exits within seconds* → something else holds 8799 (`lsof -nP -iTCP:8799 -sTCP:LISTEN`); stop it, the job recovers on its own. *`state = running` but 8799 refuses* → wrong `__REPO_ROOT__` or the binary path; read `data/logs/lattice-dashboard.err.log`. *Deep links work on the Mac but not the phone* → the tailnet leg: `tailscale serve status` should show `:8443 -> http://127.0.0.1:8799`; that mapping is host state, not this repo's (see the three-legged block). *`lattice restart` says nothing is listening* → the job is down; `launchctl print`.

**The port is a three-legged coupling** (CTO binding 2, verbatim intent; keep it to one short block — a signpost, not an essay):

> `8799` appears in three places that must agree, and only one of them is in this repo's launchd job:
>
> | Leg | Where | Owned by |
> |---|---|---|
> | L1 | `--port 8799` in `com.american-software.lattice-dashboard.plist.template` (this job) | this repo; guarded by `test/launchd-plist.test.js` |
> | L2 | Tailscale serve `:8443 -> http://127.0.0.1:8799` | tailscaled's state on the host — **not** a repo artifact, and chat cannot observe it |
> | L3 | `LOOPBACK_PORT = 8799` / `REMOTE_PORT = 8443` in `apps/chat/public/dashboard-link.js` (AS-93) | this repo |
>
> Moving one leg alone breaks a surface: **L1 alone** kills the phone *and* the Mac; **L1 + L2** kills the Mac; **L1 + L3 without L2** kills the phone. `LATTICE_DASHBOARD_URL` does not rescue any of these — it is one verbatim base, so it can say "this URL everywhere" but never "port X on loopback, port Y over the tailnet"; pointing it at a non-8799 loopback URL fixes the Mac and re-breaks the phone. The dashboard port question itself was moved upstream to the Lattice project by the board on 2026-09-10 (DM msg 632; AS-96 cancelled) — until that lands, `8799` is the CLI default and the declared value here.

### 4.2 `apps/chat/README.md` — "Links to Lattice", replace lines 205-210

Replace the paragraph beginning "The links are live only while the dashboard is running on the host — **run `lattice dashboard`**" with:

> The links are live only while the dashboard is listening on the host. **Since
> AS-94 that is a supervised launchd user agent**
> (`com.american-software.lattice-dashboard`, install/restart/troubleshooting in
> `watch/README.md` "Lattice dashboard"): it starts at login, is relaunched if it
> dies, binds `127.0.0.1:8799` only, and is the one owner of that port — do not
> hand-run `lattice dashboard` beside it; `lattice restart` bounces it. If a link
> is well-formed but dead (connection refused), the job is down: `launchctl print
> gui/$(id -u)/com.american-software.lattice-dashboard`. Deliberate decision
> (AS-10 plan, unchanged): the dashboard is NOT part of compose — it is vendor
> tooling that ships with the Lattice CLI (host pipx install), the same category
> as `git`; the watcher is the precedent for supervising it, not compose. The
> port is a three-legged coupling (launchd job, Tailscale serve mapping,
> `dashboard-link.js`) — the table in `watch/README.md` says which surface each
> leg breaks.

Do not touch the env table row at `:498` (AS-93's wording stands) or anything else in the file.

---

## §5. Proving the guards (M4) — one falsifier per property, run AFTER §2–§4 are committed on the branch

**Scratch copy = a detached second worktree, never `$W`:**

```
M=/Users/forrest/Code/american-software-company
S=/tmp/AS-94-mutant
git -C $M worktree add --detach $S feat/AS-94-dashboard-launchd
```

Each mutant: apply in `$S`, **assert it applied** (a grep-count transition on a `MUTANT-<id>` marker or on the mutated token, plus `git -C $S diff --stat` naming exactly the intended file — an unapplied mutation looks exactly like a passing checker), run the suite from `$S` with its own compose project, record `# tests` / `# pass` / `# fail` **and the names of the failing tests**, then `git -C $S checkout -- .` before the next.

```
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose -f $S/apps/chat/compose.yaml -p asc-as94-mutant --profile tools run --rm --build test
```

| Mutant | Change in `$S` | Applied-assertion | Expected EXACT failing set |
|---|---|---|---|
| **M-AC1** (well-formedness) | in the dashboard template, delete the line `</array>` after `<string>8799</string>` + a `<!-- MUTANT-AC1 -->` comment | marker 0→1; `grep -c '</array>'` 1→0 | **{T1, T2}** — both parse the dashboard file; T1's message names which of the 2 templates failed. **Host half (whoever has a shell, §7 step or a live-session reviewer):** `sed`-render the mutated template to a scratch path and run `plutil -lint` on it → red ("Encountered unexpected …" / non-OK). Quote both. |
| **M-AC2a** (bind) | `<string>127.0.0.1</string>` → `<string>0.0.0.0</string>` in the dashboard template | `grep -c '0.0.0.0'` 0→1 | **{T2}** only; T1 green (T1 does not read ProgramArguments — that asymmetry is deliberate: the common-shape test must not duplicate the exact-args test). |
| **M-AC2b** (port) | `<string>8799</string>` → `<string>8800</string>` | `grep -c 8799` in the template 1→0 | **{T2}** |
| **M-AC2c** (cwd) | dashboard `WorkingDirectory` → `<string>__REPO_ROOT__/apps/chat</string>` | grep 0→1 | **{T1, T2}** (both assert WorkingDirectory) |
| **M-AC2d** (env leak) | add `<key>ADVANCE_REPO_ROOT</key><string>__REPO_ROOT__</string>` inside the dashboard `EnvironmentVariables` dict | grep 0→1 | **{T2}** (the key-set assertion) |
| **M-KEEPALIVE** | dashboard `KeepAlive` `<true/>` → `<false/>` | `grep -c '<false/>'` 0→1 | **{T1}** — this is the "survives crashes" property; AC-3's kill test is its host-side twin |
| **M-LEFTOVER** | add `<string>__EXTRA__</string>` to the dashboard `ProgramArguments` | grep 0→1 | **{T1, T2, T3}** — T1 (leftover placeholder), T2 (exact args), T3 (template placeholder set ≠ recipe set). Three reds from one mutant is the point: the placeholder discipline is enforced from three directions. |
| **M-RECIPE** | in `watch/README.md`, in the dashboard install block only, change `s\|__LATTICE_BIN__\|` to `s\|__LATTICE__\|` | grep `__LATTICE__` 0→1 | **{T3}** only — the template is untouched; the *recipe* drifted. |
| **M-ENUM** | `git -C $S mv` the dashboard template to `watch/lattice-dashboard.plist.template` (drops the `com.american-software.` prefix from the *filename*) | `ls $S/apps/chat/watch/*.template` shows the renamed file | **{T1, T2, T3}** — T1 (Label ≠ prefix+basename), T2/T3 (the file the tests open by its canonical name is missing → throws). Proves the directory enumeration is real and the label/basename rule bites. |

**A wider or narrower failing set than predicted is itself a finding — report it; do not edit the expectation to match.** (AS-93's table was wrong in three rows; the record of *that* is what made it trustworthy.)

**Restore and prove:** `git -C $M worktree remove --force $S`; `docker image rm asc-as94-mutant-test`; `git -C $W status --porcelain` shows nothing you did not intend; `git -C $W diff --exit-code` clean. Then **rebuild and re-run** the real suite from `$W` — a restored tree with a stale mutant image produced phantom failures once already.

**Fallback only if the detached worktree is impossible:** in place in `$W`, as a **single Bash invocation** (cwd and shell state reset between tool calls, so a `trap` does not survive a second call): back up, `trap` the restore on `EXIT`, mutate, assert applied, run, let the trap restore, `git -C $W diff --exit-code -- <file>`, then rebuild and re-run.

### The `--build` receipt rule (AC-6, verbatim CLAUDE.md corollary)

The `test` service is mountless and COPYs `test/` and `watch/` into the image, so it runs the branch's bits **only if the image is rebuilt** — `--build`, always, and the `Image <name> Built` line in the output is the receipt. **A quoted number without a `Built` line is void.** No `--progress quiet`.

```
DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose -f $W/apps/chat/compose.yaml -p asc-as94-<actor> --profile tools run --rm --build test
```

`-p asc-as94-<actor>` (`lena`, `priya`/`ruben`) keeps images apart. **Measure the baseline `# tests` on the unmodified branch tip first** (do not carry a number from AS-93), then after §3 expect baseline + 4, `# fail 0`. Remove your image when done (`docker image rm asc-as94-<actor>-test`).

---

## §6. Commits (two, both under `apps/chat/`, none touching `.lattice/`)

1. `AS-94: add the Lattice dashboard launchd template and the plist guard` — §2 template + §3 test.
2. `AS-94: document the supervised dashboard in both chat READMEs` — §4.1 + §4.2.

Commit as the employee: `git -c user.name="developer-lena" -c user.email="developer-lena@agents.american-software.local" commit -m "AS-94: …"`. Projected total ≈ 365 changed lines (template ~50, test ~180, watch README ~120, chat README ~15). Split trigger: none expected; if the guard passes 300 lines, the parser is doing too much — narrow it, do not split.

---

## §7. The `needs_human` handoff (decision 3) — the text the implementer posts

After both commits, the implementer moves the task to **`review`** as normal (the code half is reviewable now); the **reviewer**, after recording the review, moves it to **`needs_human`** (not `done`) with the comment below, because AC-3/AC-4 are host observations no tick can make. **Do not `--force` to `done`.** The reviewer's comment goes on the task **and** (per the PR rule — a `needs_human` on a diff opens a PR) the branch is pushed and a PR opened with the review posted to it; the PR URL goes in the comment and in the chat reply to the board.

Handoff text (fill the PR URL; keep the commands verbatim — they are the README recipe, so a discrepancy between the two is itself a finding):

> **Need: a host shell (board or live session) to bootstrap the dashboard launchd job and quote four observations back on AS-94.** Code + docs are on `feat/AS-94-dashboard-launchd` (PR <url>), reviewed; the guard is green in the compose suite with a `Built` receipt. Nothing is installed yet — a tick cannot run `launchctl`. ~5 minutes.
>
> ```sh
> cd /Users/forrest/Code/american-software-company           # MAIN checkout, on master
> ls ~/Library/LaunchAgents/                                   # expect the watcher plist; no lattice-dashboard plist yet
> tailscale serve status                                       # expect :8443 -> http://127.0.0.1:8799 (the L2 leg; quote it)
>
> # A. stop the live-session dashboard that currently owns :8799 (at planning time pid 52536,
> #    started with no args; a SECOND dashboard on :8805, pid 78002, is unrelated — leave it)
> lsof -nP -iTCP:8799 -sTCP:LISTEN
> pgrep -fl 'lattice dashboard'
> kill <pid from lsof>; sleep 1; lsof -nP -iTCP:8799 -sTCP:LISTEN   # must print nothing
>
> # B. render, lint, install (identical to apps/chat/watch/README.md "Lattice dashboard > Install")
> REPO_ROOT="$(git rev-parse --show-toplevel)"; LATTICE_BIN="$(command -v lattice)"; LABEL=com.american-software.lattice-dashboard
> mkdir -p "$REPO_ROOT/apps/chat/data/logs"
> sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" -e "s|__LATTICE_BIN__|$LATTICE_BIN|g" \
>     -e "s|__PATH__|$(dirname "$LATTICE_BIN"):/usr/bin:/bin|g" \
>     "$REPO_ROOT/apps/chat/watch/$LABEL.plist.template" > ~/Library/LaunchAgents/$LABEL.plist
> plutil -lint ~/Library/LaunchAgents/$LABEL.plist             # AC-1 host half: expect "OK"
> launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/$LABEL.plist
>
> # C. the four AC-3 observations — quote each line verbatim
> launchctl print gui/$(id -u)/$LABEL | grep -E 'state|pid|last exit'          # (1) state = running
> curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8799/              # (2) 200
> kill $(lsof -nP -iTCP:8799 -sTCP:LISTEN -t); date +%T                         # (3) kill the pid, note the time
> for i in $(seq 1 30); do sleep 1; curl -s -o /dev/null -w "%{http_code} after ${i}s\n" http://127.0.0.1:8799/ && break; done   # (4) 200 again within 30 s
>
> # D. AC-4 — single owner: the manual copy must FAIL to bind; quote its error
> lattice dashboard --host 127.0.0.1 --port 8799
>
> # E. bonus, one line: does SIGHUP keep the pid or relaunch it?  (either is fine; say which)
> lattice restart; sleep 2; launchctl print gui/$(id -u)/$LABEL | grep -E 'state|pid'
> ```
>
> Then, from the phone, open any `AS-n` link in chat: it should resolve at `https://forrests-newer-macbook.tail3f3c29.ts.net:8443/#/task/…`. Reply here (or on the PR) with the quotes from B (plutil), C (four lines), D (the bind error), E, and the `tailscale serve status` line. If D does **not** fail — the CLI picks another port or otherwise "succeeds" — say so: the README's AC-4 sentence is then wrong and the task comes back for a wording fix before merge. If `tailscale serve status` shows no `:8443` mapping, that is a separate host record, not this task.

Whoever posts the observations (the board, or the live-session orchestrator with `--on-behalf-of human:forrest`) attaches them as a comment on AS-94; the next tick then merges `--no-ff` from `$M` and closes as `done`. **The install is not the merge's precondition** (code is reviewable and correct without it) — but `done` waits for the observations because AC-3/AC-4 are numbered criteria and an unobserved criterion is not met.

---

## §8. Where the description is wrong or incomplete — corrections this plan makes

1. **The process to stop is not pid 37867 and there are two dashboards, not one** (§0). AC-4's "pgrep line that finds it" becomes `lsof -nP -iTCP:8799 -sTCP:LISTEN` (finds the *port owner*) plus `pgrep -fl 'lattice dashboard'` (shows *all* dashboards so the operator knows which not to kill). The README and §7 carry both.
2. **AC-1's `plutil -lint` cannot run inside a tick** (not allowlisted, macOS-only). AC-1 is split: the **in-suite half** is T1/T3 (render + strict parse + recipe/template placeholder equality) with **M-AC1** as its falsifier; the **host half** is `plutil -lint` in the install recipe itself, observed by whoever bootstraps (§7 step B) — and, if the reviewer has a live shell, on the M-AC1 mutant too. A review that could not run `plutil` says so and does not pretend the parser is `plutil`.
3. **AC-2 is widened, not changed:** exact `ProgramArguments` and `WorkingDirectory` as written, plus the things that would make a "correct" args line useless — `KeepAlive`/`RunAtLoad` true, log paths under the fixed directory, no stray env keys, no leftover placeholders, and the recipe's placeholder set equal to the template's (T3). Each addition has its own row in §5.
4. **AC-5's "mirroring" is made literal:** identical subsection headings in the same order (§4.1) so the side-by-side comparison is a diff, not a judgement.
5. **The three-legged block (CTO binding 2) states the legs as a fact.** AS-96 was cancelled today (board DM msg 632: the port question moves upstream to Lattice); the README must not promise this repo will unify the legs, and the plist declares `8799` plainly (binding 1).
6. **The Tailscale-persistence assumption expired at its time-box with the default "yes"** (§0). §7 asks for `tailscale serve status` in the same host session so the record carries an observation instead of a default.
7. **The guard enumerates the directory and also covers the watcher's template** (T1). Not scope creep: the guard's shape is "every template under `watch/`", and hard-coding one filename is how the next template escapes (the AS-93 AC-9 lesson). The watcher template gets the *common* assertions only; nothing about it changes.

---

## §9. Acceptance criteria — the review floor (M5: findings first, this sweep second; M6: probe past it)

- **AC-1** = T1 and T3 green on the branch tip; **M-AC1** observed red on exactly `{T1, T2}`; `plutil -lint` **OK** quoted from the host (§7 B) — and, if the reviewer has a host shell, plutil red on the M-AC1 render too. If no host shell in review, the comment says "plutil half deferred to the bootstrap record".
- **AC-2** = T2 green with the exact six-element array; **M-AC2a** (`0.0.0.0`) red on exactly `{T2}`, tree proven clean with `git diff --exit-code`; M-AC2b/c/d and M-KEEPALIVE/M-LEFTOVER/M-RECIPE/M-ENUM each observed with the failing set in §5's table.
- **AC-3** = the four quoted host observations on the task (state = running; 200; kill; 200 again within 30 s with the elapsed seconds) — recorded by the bootstrap runner, **not** by the reviewer. Until they exist the task sits in `needs_human`, not `done`.
- **AC-4** = the quoted bind failure from §7 D **and** the README sentences: "one owner", "do not run beside it", the pre-bootstrap stop step with the `lsof` + `pgrep` lines.
- **AC-5** = `watch/README.md` gains the section with the six mirrored subsection headings + the three-legged block; `apps/chat/README.md:205-210` replaced by §4.2's text with the AS-10 rationale intact; the reviewer pastes the two Install blocks side by side and lists every line that differs.
- **AC-6** = every quoted suite number carries a `--build` run with its `Image … Built` line; branch-tip `# tests` = baseline measured on the branch + 4, `# fail 0`.

Added by this plan:

- **AC-7 — mutation cardinality.** Each §5 mutant asserted applied before its run; each failing set exactly as predicted or the discrepancy reported as a finding; every run with its `Built` receipt.
- **AC-8 — nothing left behind.** No `asc-as94-*` images, no `/tmp/AS-94-*`, `git worktree list` shows master and `.worktrees/AS-94` only, both clean; **no launchd job installed by anyone in a tick**; the two running dashboards (52536, 78002) untouched by the implementer and reviewer (`pgrep -fl 'lattice dashboard'` — reviewer quotes it if allowlisted; otherwise says it could not).
- **AC-9 — the handoff comment is the README recipe.** The `sed`/`plutil`/`bootstrap` lines in §7 are byte-identical to `watch/README.md`'s Install block (modulo the `#` comments). Reviewer diffs them.

**Places the reviewer should probe past the list (M6 — budget time for this):**

- The parser is the guard's weakest joint. Feed it a template that is *valid plist but not what we mean* — `ProgramArguments` as a `<dict>`, `<true/>` for `WorkingDirectory`, a duplicate `<key>ProgramArguments</key>` (last-wins? first-wins? throw?) — and report what stays green. Duplicate keys in particular: `plutil` accepts them and launchd's behaviour is undocumented; the parser should **throw** on a duplicate key. If it does not, that is a finding with a one-line fix.
- `renderTemplate` with a value containing `|` or `&` — the README's `sed` uses `|` as its delimiter, so a `REPO_ROOT` containing `|` silently corrupts the render on the host while the node test (plain string replace) stays green. Not a defect to fix here (no sane path contains `|`), but name it in the README's Prerequisites if you think it is worth a sentence.
- T3's README block finder: does it find the *dashboard* block and not the watcher's when both contain `sed -e`? Swap the two blocks' order in a scratch copy; T3 must still pass, and M-RECIPE applied to the *watcher* block must go red on the watcher pair, not the dashboard pair.
- The chat README's env-table row (`:498`) and AS-93's "Links to Lattice" prose above the replaced paragraph must be byte-identical to master — `git diff master...feat/AS-94-dashboard-launchd -- apps/chat/README.md` should show only §4.2's paragraph.
- Confirm no test outside `launchd-plist.test.js` changed and the `IMAGE_INPUTS`/`deploy-shape` tests are untouched and green (the new template lands under `watch`, already an input).
