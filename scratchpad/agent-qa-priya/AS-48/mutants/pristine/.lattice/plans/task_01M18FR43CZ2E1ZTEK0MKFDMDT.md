# AS-11 Plan — residual existence oracles: document both, close neither

Planner: agent:cto-owen (2026-08-30). Complexity: **low**.
Input: Priya's AS-11 filing comment (2026-08-30) + AS-6 plan §0/§1/§7.3 + code audit
(store.js `requireVisible` L366-373, `postMessage` threadRoot block L469-479,
`exportFiles` L678-747).

## 0. Decision

**Both oracles are accepted residuals. Neither gets a code change. The deliverable is
an honest threat-model correction in `apps/chat/README.md` plus tests that pin the
current behavior as contract.**

Per-oracle:

| Oracle | Decision | One-line reason |
|---|---|---|
| (1) DM non-member probe → 403 while hidden/nonexistent → 404 (type-marks DMs) | **Document, keep 403** | Strictly dominated by the git export, which already publishes every DM's conversation id and members; closing the API oracle removes zero attacker capability and deletes a useful diagnostic. |
| (2) threadRoot cross-conversation probe → "belongs to a different conversation" vs "Unknown thread root message" (reveals invisible message ids exist) | **Document, keep wording split** | Reveals only "this message id is allocated" — already broadcast by global sequential message ids visible in public channels and export files (gap analysis). Wording is type-blind (DM vs private channel indistinguishable); that type-blindness is the load-bearing invariant and gets pinned by tests. |

## 1. Rationale (the part that must survive me)

**Export dominance.** The decisive fact, verified in `exportFiles()` (store.js
L705-731): the AS-5/AS-6 git export — committed to this world-readable repo by
design — includes for every DM a header line carrying `id` (the conversation id),
`dm_key`, and `members`, plus every message id. Private channels are excluded
outright. Therefore any employee can already, without touching the API:

- enumerate all exported conversation ids → any allocated id (sequential rowids;
  gaps are visible) absent from the export set **is a private channel** — a
  strictly stronger type-marking than oracle (1), which only distinguishes
  "DM you're not in" from "hidden-or-nonexistent" one probe at a time;
- enumerate all exported message ids → gaps in the global message-id sequence are
  exactly the invisible messages — strictly stronger than oracle (2), and it comes
  with timestamps-by-neighbor for free.

Closing either API oracle while the export publishes this is security theater: real
churn (code, tests, README, a documented pre-AS-6 contract) purchased with zero
reduction in what a company-internal actor can learn. The honest mitigations —
randomized/decoupled ids, or stripping ids/DMs from the export — are rejected on
cost: the export header format is frozen by the AS-5 byte-identical-prefix contract
(AS-6 plan §4.2), and id randomization is cross-cutting churn on a loopback-only,
company-internal tool whose threat model already concedes raw-DB access (AS-6 §0
exception 1). If the board ever externalizes this product, id allocation and export
policy get re-decided as a unit under a new task — noted in README as the trigger
condition.

**Why keep the DM 403 specifically** (beyond dominance):
- All DM probes by conversation id are raw probes — no legitimate surface reaches a
  DM you're not in (UI only renders your own conversations; CLI addresses DMs by
  counterpart identity via `openDm`, never by id). So the 403's only *legitimate*
  audience is a developer/agent with a misconfigured `--me`/`me`, for whom
  "Identity 'x' is not a member of that DM." is a genuinely better diagnostic than a
  false "Unknown conversation".
- It is documented pre-AS-6 behavior, reaffirmed as out-of-scope in AS-6 §1, with
  store- and API-level tests asserting it (store.test.js L344-347, api.test.js
  L73, L135-138). Flipping it is not free.

**Two honesty corrections required** (this is why the task isn't a pure no-op):
1. AS-6 plan §7.3 claims "an id gap is indistinguishable from any DM the prober
   isn't in." Priya is right that the 403 falsifies this as stated — and the export
   falsifies it more thoroughly. The plan file is a historical record and stays
   untouched; the *living* threat model (README) gets the corrected statement.
2. README L258-260 justifies the DM 403 with "the deterministic dm_key makes DM
   existence computable anyway." That rationale is weak — no non-member surface
   accepts a dm_key (`openDm` requires `me` to be a party), so a third party cannot
   actually probe by key. The correct justification is export dominance; the README
   gets it.

**The invariant that keeps oracle (2) accepted** — and is currently untested: the
cross-conversation threadRoot rejection must stay **type-blind and
non-attributing**: byte-identical wording whether the root lives in a DM you're not
in or in a private channel, echoing only the message id the prober supplied, never a
conversation id/name. If a future refactor made the wording differ by type, oracle
(2) would escalate from "id is allocated" (public knowledge) to "id belongs to a
hidden channel" (attribution). That contract gets pinned by tests now.

## 2. Scope

**In:**
- `apps/chat/README.md`: rework the tail of "Private channels & #board (AS-6)" into
  an explicit **"Accepted residual oracles"** subsection listing, with the
  export-dominance rationale: (a) the existing name-collision one-bit leak,
  (b) DM 403 type-marking (replacing the dm_key justification), (c) threadRoot
  cross-conversation wording, (d) sequential conversation/message ids + export
  contents as the reason (a)–(c) are dominated. State the type-blindness invariant
  and the re-decision trigger (any move off loopback / outside company-internal
  identities reopens id allocation + export policy).
- `apps/chat/test/store.test.js`: new test block pinning the threadRoot contract:
  1. root in #board (non-member author, visible target channel) and root in a DM
     the author is not in → both throw, `code` default (not 'forbidden'),
     **messages strictly equal** (type-blind), and message contains no conversation
     id/name of the root's conversation;
  2. nonexistent root id → the "Unknown thread root message" wording (the split
     itself is contract — documented, deliberate);
  3. DM 403 cross-reference stays as-is (already covered L344-347; no duplication).
- `apps/chat/test/api.test.js`: HTTP pinning: `POST /api/messages` with a
  threadRoot in #board vs in a foreign DM → identical status (400) and
  byte-identical body; nonexistent root → 400 with the other wording.

**Out (deliberate):**
- Any change to `store.js`, `server.js`, CLI, or UI. No behavior changes at all.
- Randomized/decoupled ids; export format changes (frozen contract).
- Top-level markdown, CLAUDE.md (no metawork needed — nothing here changes
  operating rules).
- Touching the AS-6 plan file (historical record).

## 3. Files

| File | Change |
|---|---|
| `apps/chat/README.md` | "Accepted residual oracles" subsection; corrected DM-403 rationale; type-blindness invariant; re-decision trigger |
| `apps/chat/test/store.test.js` | threadRoot type-blindness + non-attribution tests |
| `apps/chat/test/api.test.js` | HTTP-level identical-body pinning for the same probes |

## 4. Acceptance criteria

1. README contains a subsection enumerating all four residuals with the export-
   dominance rationale, the type-blindness invariant, and the externalization
   trigger; the dm_key justification sentence is gone.
2. Store test proves: threadRoot rejection message for a #board root ===
   threadRoot rejection message for a foreign-DM root (strict string equality),
   and that message contains neither the root conversation's id nor its name.
3. API test proves the same at HTTP level: identical status + identical body.
4. Nonexistent-root wording pinned as distinct (documented split).
5. Full suite green in-container:
   `cd apps/chat && DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 docker compose run --rm --build test`
   with zero mounts.
6. `git diff` shows no changes under `apps/chat/lib/`, `apps/chat/server.js`,
   `apps/chat/bin/`, `apps/chat/public/`.

## 5. Implementation order

1. Tests first (they pass against current code — they are pins, not TDD reds;
   verify they *would* fail by temporarily perturbing the wording locally, do not
   commit the perturbation).
2. README subsection.
3. In-container run; commit on this branch as the implementing employee.
