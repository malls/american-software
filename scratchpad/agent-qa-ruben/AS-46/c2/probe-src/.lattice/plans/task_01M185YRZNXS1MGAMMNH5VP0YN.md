# AS-4: Containerize chat app — docker compose is the only way code runs

**Author:** Owen Kessler, Cofounder & CTO (`agent:cto-owen`) — 2026-08-30
**Directive:** Investor, recorded in `CLAUDE.md` ## Infra: all local apps run via Docker / Docker Compose; no code runs bare on the host.
**Inputs:** Task AS-4 description; the shipped AS-2 app under `apps/chat/` (read its README and `lib/`, `bin/`, `server.js` before starting); AS-2 plan `.lattice/plans/task_01M1847PZM8BWCV2SWM2MMCF2Y.md` for the original acceptance criteria.
**Audience:** `agent:developer-marcus`, cold context. Verified on host: Docker 29.6.1, Compose v5.3.0, daemon running.

Conclusion first: build one small image from the official `node:24-slim` base with the app COPY'd in; run three compose services off that one image — `server` (long-running, loopback-published), `cli` (one-off `docker compose run`, wrapped in a `chat` shell script), `test` (one-off `node --test`). Chat data stays a bind mount at `apps/chat/data/` (same file as today — zero migration); `.lattice/` mounts read-only. `--build` on every one-off run kills image staleness. Nothing about the app's code changes except nothing invokes host `node` anymore.

## 0. Assumptions and non-goals

- The AS-2 app is done and passed review; **this task changes how it runs, not what it does.** No feature work, no schema changes, no AS-3 scope (that's a separate backlog task — leave it).
- App code changes should be near-zero. The app already reads `PORT`, `CHAT_BIND`, `CHAT_DB`, `CHAT_REPO_ROOT`, `CHAT_ME` from env (AS-2 plan §8 anticipated exactly this). If you find yourself editing `lib/` or `server.js` beyond trivialities, stop and comment on the task.
- Images: **official Docker Hub library images only** (`node:24-slim`) — my zero-dependency stance extends to images. No third-party registries, no accounts, no spend. The only network egress in this whole task is the one-time image pull.
- Host is Forrest's Mac (Docker Desktop). Linux-host portability is a note, not a requirement.

## 1. Files to create (all under `apps/chat/` unless noted)

### 1a. `Dockerfile`

```dockerfile
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    CHAT_DB=/app/data/chat.db \
    CHAT_REPO_ROOT=/repo
COPY package.json server.js ./
COPY lib ./lib
COPY bin ./bin
COPY public ./public
COPY test ./test
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8347
CMD ["node", "server.js"]
```

Rationale, so you don't relitigate it: `node:24-slim` over `alpine` because glibc-Debian is the boring choice and image size is irrelevant locally; over full `node:24` because slim drops hundreds of MB of toolchain we can't use anyway (no npm installs, ever — if a `RUN npm install` sneaks into this Dockerfile, the design has been violated). Tests are COPY'd into the image deliberately: the `test` service runs the exact bits the image ships, which is the point of testing in-container. `USER node` is hygiene; Docker Desktop's file sharing maps bind-mount ownership so the existing `data/chat.db` (owned by forrest on the host) stays writable — if you hit an EACCES on the DB, note it on the task before working around it.

### 1b. `.dockerignore`

```
data/
README.md
Dockerfile
compose.yaml
.dockerignore
chat
```

Keeps operational state and docs out of the build context; context stays tiny so `--build` everywhere is cheap.

### 1c. `compose.yaml`

```yaml
name: asc-chat

services:
  server:
    build: .
    ports:
      - "127.0.0.1:8347:8347"
    environment:
      CHAT_BIND: 0.0.0.0
    volumes:
      - ./data:/app/data
      - ../../.lattice:/repo/.lattice:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8347/api/identities').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 5s
      retries: 3

  cli:
    build: .
    profiles: ["tools"]
    entrypoint: ["node", "bin/chat.js"]
    environment:
      - CHAT_ME
    volumes:
      - ./data:/app/data
      - ../../.lattice:/repo/.lattice:ro

  test:
    build: .
    profiles: ["tools"]
    command: ["node", "--test"]
```

The three deliberate subtleties, spelled out:

1. **Loopback survival across the port map.** Inside the container the server must bind `0.0.0.0` (Docker's proxy reaches it over the bridge network; binding 127.0.0.1 *inside* would make the port map dead). Loopback-only exposure moves to the **host side** of the mapping: `"127.0.0.1:8347:8347"` tells Docker to bind the host listener on loopback only. The security property is preserved, just enforced one layer up. `CHAT_BIND: 0.0.0.0` is set only in compose — the app's own default stays `127.0.0.1`, so even an accidental bare-node run (forbidden, but still) stays safe.
2. **`profiles: ["tools"]`** keeps `cli` and `test` out of `docker compose up` — they are one-shot commands, not services. `docker compose run` ignores profiles for the named service, so `run --rm cli …` and `run --rm test` just work.
3. **`CHAT_ME` passthrough:** listing a bare `- CHAT_ME` under `environment` forwards the host env var into the container when set. `--me` flags continue to work as before since args pass through the entrypoint.

### 1d. `chat` — the wrapper script (mode 755)

```bash
#!/usr/bin/env bash
# Agent-facing chat CLI, containerized (AS-4). Usage identical to the old
# `node bin/chat.js` invocation:  ./apps/chat/chat inbox --me agent:...
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
exec docker compose run --rm --build -T --quiet-pull cli "$@"
```

Contract (test all four): args pass through verbatim; `CHAT_ME` from the caller's env reaches the CLI; the container's exit code is the script's exit code (`compose run` propagates it — `chat inbox` keeps its exit-0 "Nothing new." contract); stdout carries only the CLI's output so `--json | jq` still works (compose build/progress noise goes to stderr — verify with a redirect test, and if anything leaks to stdout, add `--progress quiet` to the compose invocation). `-T` because agents pipe output; never allocate a TTY. `--build` on every invocation is the staleness defense: the image silently going stale after a code edit is THE failure mode of a COPY-based image, and with a tiny cached context the rebuild check costs well under a second.

**Session-start ergonomics for agents** (this goes in the README verbatim):

```sh
export CHAT_ME=agent:developer-marcus
./apps/chat/chat inbox
./apps/chat/chat reply engineering#42 "Done — see AS-4."
```

First-ever invocation pulls `node:24-slim` and builds; subsequent invocations add ~1s of container start overhead per command. At our message volume that is acceptable; if it ever isn't, batching commands or a long-lived `exec` path is a future task, not an improvisation.

## 2. Data and `.lattice/` access — the calls and why

- **`chat.db` stays a bind mount at `apps/chat/data/` → `/app/data`.** Not a named volume. Reasons: (a) zero migration — the existing DB keeps working the moment compose starts, and `docker compose down` can never strand data inside a volume; (b) backup/inspection ergonomics survive — host `sqlite3` can open it, `./apps/chat/chat dump > backup.jsonl` works, and the path is already gitignored; (c) a named volume's only advantage here is Linux-server fsync performance, which is a DO-deployment concern, not a laptop concern. Watch item: SQLite WAL over Docker Desktop's VirtioFS is fine at our write volume, but if tests or usage ever show `SQLITE_BUSY` storms, that's a finding to report, not to patch around.
- **`.lattice/` mounts read-only** (`../../.lattice:/repo/.lattice:ro`) with `CHAT_REPO_ROOT=/repo` baked into the image env. The app was already write-never toward `.lattice/` by design; `:ro` makes the kernel enforce what was previously a convention. Event ingestion (`chat inbox`, `chat sync`, server startup/throttled scans) reads through this mount unchanged. Note the mount is the *directory*; new event files appearing after container start are visible (it's the same filesystem).

## 3. Tests in-container

The documented, canonical test invocation becomes:

```sh
docker compose -f apps/chat/compose.yaml run --rm --build test
```

`node --test` runs inside the image against the COPY'd `test/` and fixtures; tests already use temp dirs and fixture `.lattice/` trees, so the `test` service needs **no** volumes — it must pass with zero mounts, which is itself evidence the suite doesn't leak onto real state. If any test fails only in-container (path assumptions, `/tmp`, TZ), fix the *test* unless the failure reveals a real app bug — then comment on the task first.

## 4. README and the old bare-node instructions

Rewrite `apps/chat/README.md` run sections:

- "Run the server": `docker compose -f apps/chat/compose.yaml up -d --build` (and `down`, `logs -f server`). State plainly: **per investor directive (CLAUDE.md ## Infra), docker compose is the only supported way to run this app; bare `node` invocations on the host are forbidden.** Delete the old `node apps/chat/server.js` and `node apps/chat/bin/chat.js` instructions entirely — do not leave them as an "alternative"; a forbidden path documented is a forbidden path taken. One line may note the history ("pre-AS-4 this ran bare on Node 24; see git history").
- CLI section: `./apps/chat/chat <command>` everywhere the old `node …/chat.js` appeared; keep the command table as-is (commands didn't change); update the "typical agent session start" block per §1d.
- Env-var table: keep it, add a column or note for what compose sets (`CHAT_BIND=0.0.0.0`, `CHAT_DB=/app/data/chat.db`, `CHAT_REPO_ROOT=/repo` in-container) versus what callers still set (`CHAT_ME`, `PORT` via compose override only).
- Tests section: the §3 invocation.

## 5. Implementation sequence

1. **M0 — Branch.** `feat/AS-4-containerize` off master; `lattice branch-link AS-4 feat/AS-4-containerize --actor agent:developer-marcus`; status to `in_progress` is already the orchestrator's job — confirm it before first commit.
2. **M1 — Image + compose.** Dockerfile, `.dockerignore`, `compose.yaml`. `docker compose up -d --build`; browser check at `http://127.0.0.1:8347/`; existing messages present (bind mount continuity).
3. **M2 — Wrapper + CLI parity.** `chat` script; run the four-part contract test in §1d; `chat inbox` round-trip as a real identity.
4. **M3 — Tests in-container** green per §3.
5. **M4 — README rewrite** per §4; full acceptance pass (§6); commit; task to `review` for `agent:qa-priya`.

Commit scope: `apps/chat/Dockerfile`, `apps/chat/.dockerignore`, `apps/chat/compose.yaml`, `apps/chat/chat`, `apps/chat/README.md`. Never: `CLAUDE.md`, `PHILOSOPHY.md`, `.lattice/` beyond CLI-managed writes, `apps/chat/data/` (already gitignored — verify `git status` stays clean of it). Shared-worktree rules apply as always.

## 6. Acceptance criteria

| # | Criterion |
|---|---|
| C1 | `docker compose -f apps/chat/compose.yaml up -d --build` from a clean checkout (plus existing `data/`) serves the UI at `http://127.0.0.1:8347/` in a host browser; pre-existing messages and read-state are intact (no migration, same DB file) |
| C2 | Loopback-only exposure, verified two ways: `docker inspect` shows the port binding host IP `127.0.0.1`, and `lsof -iTCP:8347 -sTCP:LISTEN` shows the listener bound to `127.0.0.1`/`localhost` only — nothing on `*` or the LAN address. A second machine on the LAN (or `curl http://<lan-ip>:8347` from the host) gets connection refused |
| C3 | `./apps/chat/chat inbox` with `CHAT_ME` set works with the server container **stopped** (CLI is server-independent, as before) and with it running (WAL concurrency across two containers over the bind mount) |
| C4 | Wrapper contract: args verbatim, `CHAT_ME` env passthrough, exit-code propagation (`chat inbox` exits 0 when clean; a bogus command exits non-zero), `--json` stdout clean enough for `jq` with stderr redirected |
| C5 | Lattice ingestion still works and is still idempotent from inside the container: `./apps/chat/chat sync` twice posts no duplicates; a fresh Lattice event (e.g. this task's own status transitions) appears in `#lattice-events` |
| C6 | Data survives `docker compose restart` AND full `docker compose down` + `up` (bind mount — trivially true, but demonstrate it: post a message, down/up, message present, unread state preserved) |
| C7 | `docker compose run --rm --build test` passes the full `node --test` suite in-container with no volumes mounted |
| C8 | No AS-2 regression: spot-walk Carla's AC1–AC10 from the AS-2 spec against the containerized app (QA repeats this cold in review) |
| C9 | No bare-node paths remain in README; only compose/wrapper invocations documented |
| C10 | Zero egress beyond the initial `node:24-slim` pull; base image is Docker Hub official library; no new npm dependencies; `package.json` deps still empty |

## 7. Notes for the eventual DO deployment (record, don't build)

1. The Dockerfile is now the deployable artifact template; for DO, pin the base by digest (`node:24-slim@sha256:…`) and push to a registry — registry choice and cost need investor approval if >$50/yr.
2. The loopback host-binding trick is local-only; on DO, exposure control becomes VPC/firewall/ingress plus real auth — chat's "no auth" v1 stance is a **hard blocker** for any non-localhost deployment and must be its own task before anything is exposed.
3. The `.lattice/` read-only bind mount assumes the repo is on the same filesystem; a hosted deployment needs a different feed (repo checkout sidecar, or an export step). `lib/lattice.js` is still the single seam, as designed in AS-2 §8.
4. SQLite-on-bind-mount should become a named volume (or managed Postgres behind the `lib/store.js` seam) on a Linux host; revisit fsync behavior there.
5. `restart: unless-stopped` + the healthcheck are already DO-shaped; a future deploy task can consume the healthcheck for orchestration readiness.

## 8. Risks, time-boxed

1. **Stdout purity of `compose run`** (C4). If build/pull noise leaks into stdout despite `-T --quiet-pull`, add `--progress quiet` / `COMPOSE_PROGRESS=quiet`; box: 30 minutes, then comment and pick the least-bad flag set.
2. **Bind-mount ownership under `USER node`** (§1a). Docker Desktop should map it; if EACCES, the documented fallback is dropping `USER node` from the Dockerfile with a comment noting it's a Desktop-only concession — box: 30 minutes, record the choice on the task.
3. **VirtioFS + WAL** — watch item only (§2); report, don't patch.

— Owen
