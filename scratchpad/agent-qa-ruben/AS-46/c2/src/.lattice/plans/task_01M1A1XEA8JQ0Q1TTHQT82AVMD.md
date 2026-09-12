# AS-22: chat CLI: create-channel gains --visibility private + --members — unblock #bizdev board request

Plan by agent:cto-owen, 2026-08-30. Complexity: low. Board approval: #board msg 157
(human:forrest: "sounds good. owen, if we need to make app changes go ahead and implement."),
approving Carla's scope in msg 156.

## Problem

`store.createChannel()` (apps/chat/lib/store.js:264) already supports
`visibility:'private'` + a `members` list, with full validation: name regex,
visibility enum, non-empty members, creator-must-be-member, `requireIdentity`
per member, and the deliberately uninformative collision error for names hidden
from the actor ("Channel name 'x' is unavailable.", AS-6/AS-11 oracle
discipline). The CLI `create-channel` path (apps/chat/bin/chat.js:144-150)
hardcodes public and passes neither param — and `parseArgs` (chat.js:39-50)
whitelists flags, so `--visibility`/`--members` are currently hard errors.
There is no supported surface for creating a restricted channel; #board exists
only via store-level seeding.

## Approach — thin passthrough, store stays the single validation authority

The store code is finished and tested (store.test.js:450+). The CLI change is
plumbing only. **Zero changes to `lib/store.js`.**

1. **`parseArgs`** (chat.js ~line 43): add `--visibility` and `--members` to
   the value-taking flag list.
2. **`create-channel` case** (chat.js ~line 144):
   - Parse `--members` as comma-separated identity IDs: split on `,`, trim,
     drop empty segments. Deduplication is unnecessary (store insert is
     `OR IGNORE`) — pass through verbatim.
   - **CLI-level guard (the one piece of validation the store cannot do):**
     `--members` given without `--visibility private` → usage error, exit 1.
     Rationale: the store silently ignores `members` for public channels; a
     user typing `--members` believes they are restricting the channel, and a
     silently public "restricted" channel is the worst failure mode this
     feature can have. Fail loudly.
   - Everything else passes through:
     `store.createChannel({ name, purpose, actor: me, visibility, members })`
     with `visibility` defaulting to `'public'` when the flag is absent
     (i.e. omit/undefined — let the store's default parameter apply).
     Store errors (invalid visibility value, private-without-members, actor
     not in members, unknown identity, collision) surface via the existing
     `StoreError → fail()` path unchanged.
   - **No silent mutation:** the CLI does NOT auto-add `--me` to the members
     list. The store's "Private channel members must include the creating
     actor" error is explicit and correct; silently editing a membership list
     the operator typed is exactly the kind of invisible behavior we do not
     want in a permissions surface. (Decision made, time-box closed.)
3. **Output:**
   - Human: `Created #<name>` for public (unchanged);
     `Created #<name> (private, N members)` for private.
   - `--json`: unchanged shape — the store row from `createChannel` already
     carries `visibility`. Deliberately no `members` key: matches the AS-6
     conversation shape where `members` is populated for DMs only
     (`listConversationsFor`, store.js:411). Reading membership back can be a
     future surface if ever needed; not this task.
4. **Usage string** (chat.js USAGE): update the `create-channel` line to
   `create-channel <name> [--purpose "…"] [--visibility public|private --members <id,id,…>]`.
5. **Docs:** `apps/chat/README.md` currently states "no way to create private
   channels from the CLI/HTTP/UI (the store API supports it for tests and
   future seeds)" (~line 249). AS-22 makes that sentence false for the CLI.
   Developer updates it in the same commit: CLI can now create private
   channels; membership add/remove and visibility-change surfaces still do not
   exist; #board's seed + founder re-seed lockout protection is unchanged and
   unique to #board (CLI-created private channels get no re-seed guarantee).
   HTTP/UI creation still does not exist. (README under apps/ is app docs, not
   a protected top-level metawork file — the developer may edit it.)

## What must NOT change (regression fence)

- **Public-channel behavior:** `create-channel <name> --purpose "…"` with no
  new flags is byte-identical in behavior and output. Default visibility stays
  `'public'`.
- **AS-6/AS-11 oracle discipline:** the new flags must not create a new
  existence oracle. Note the store's validation order: member validation runs
  *before* the name-collision check, but member errors are independent of any
  hidden channel's existence (identity existence is public roster data), so no
  new leak. The collision error for a hidden name stays the uninformative
  "unavailable" wording — pinned by existing cli.test.js:96; extend it to the
  flagged invocation (test plan below).
- **#board semantics:** seeding (store.js:77-84), founder re-seed on open,
  hidden-from-non-members everywhere. Untouched.
- **Export (AS-5):** `WHERE NOT (type = 'channel' AND visibility = 'private')`
  (store.js:735) is generic over visibility, so CLI-created private channels
  are excluded from the git export automatically — by design, no code change.
  Hidden means hidden, including git (AS-6 board decision).
- **No new store semantics, no schema change, no migration.**

## Key files

- `apps/chat/bin/chat.js` — parseArgs flag list, `create-channel` case, USAGE.
- `apps/chat/test/cli.test.js` — new tests (harness exists: spawnSync child
  process against temp CHAT_DB).
- `apps/chat/README.md` — surface-inventory sentence update (see above).
- `apps/chat/lib/store.js`, `apps/chat/test/store.test.js` — read-only; the
  diff to these files must be empty.

## Test plan (extend cli.test.js)

1. **Acceptance scenario:** `create-channel bizdev --visibility private
   --members human:forrest,agent:ceo-carla,agent:cto-owen,agent:researcher-nadia,agent:researcher-elliot
   --me agent:ceo-carla` (register the two researcher identities in the temp
   DB first) → exit 0; `channels --me` shows #bizdev for a member and never
   for a non-member (text and `--json`); member can `post` to it; non-member
   `post`/`history` probes fail string-identically to a nonexistent channel.
2. **Guard:** `--members` without `--visibility private` → exit 1, usage error.
3. **Store-error passthrough:** `--visibility private` with no `--members`;
   members list missing the creator; unknown identity in members;
   `--visibility sneaky` → each exit 1 with the store's message.
4. **Oracle regression:** non-member runs `create-channel board --visibility
   private --members <selves>` → still exactly "Channel name 'board' is
   unavailable." (extends the existing collision test to the new code path).
5. **Public regression:** flagless create-channel unchanged, including `--json`
   output shape.
6. Full suite (`node --test apps/chat/test/`) green.

## Acceptance criteria

- [ ] The msg-156 five-seat #bizdev command (test 1) succeeds and the channel
      is private with exactly that membership — this is the acceptance
      scenario; the *real* #bizdev creation in the live DB is Carla's act
      after merge, not part of this task.
- [ ] All existing tests pass; `lib/store.js` diff is empty.
- [ ] New tests 1–5 above pass.
- [ ] USAGE string and apps/chat/README.md reflect the new surface.

## Out of scope (parked, not lost)

- Membership add/remove and visibility-change surfaces (no request for them;
  each is a permissions surface deserving its own design pass).
- Returning membership in `--json` / a `members <channel>` read surface.
- HTTP/UI channel creation.
- Re-seed lockout protection for non-#board private channels.
