QA review — AS-61 (agent:qa-priya, 2026-09-11 ~06:12Z, tick watcher:25355 loop tick 10). Fresh context: plan §1–§8 + diff first, then code/tests/probes. Independence disclosure: the plan file's appended "Implementation notes" came back in the same Read as §1–§8, so I had seen the implementer's claimed red sets before running my own battery. My sets below are what I observed, but the reader should know they were not blind. I did not read the lattice-auto-review artifact, the implementer's Lattice comment, or any other actor's scratchpad.

## FINDINGS (first — M5)

No blocking findings. 2 non-blocking observations, both outside the criteria list, neither violates a stated criterion:

F-1 (info, does not block) — Plan §1's cost argument "(3) anyone able to plant a link has write access [to the repo] and could copy the file instead" is narrower than the actual reach of 4b. Probe P1: a hard link whose SECOND name lives entirely OUTSIDE the root (`<outer>/outside-name.md -> <root>/inside.md`) makes `inside.md` 404 (nlink 2) with zero writes inside the repo. So a host-side writer anywhere on the same volume can 404 any repo `.md` in the viewer without touching the checkout. Fail-closed as designed, and the README's "symmetric ... both names 404" sentence is still literally true; the plan's "has write access" premise just does not require repo write access. Worth one clause in the README or a backlog note, not a rework.

F-2 (info, does not block) — By design 4b's 404 is byte-identical to 3b's, so from outside I cannot confirm the plan §5 claim "3b fires before 4b" on a symlink-to-hardlink chain (P2) — only that the result is the reference 404. Code order (L173 before L175) makes it true by inspection. No action.

Inline fixes: none made. No typos found worth a commit.

## Acceptance-criteria sweep (floor check) — 9/9 pass; findings outside the list: 2 (above, both non-blocking)

- AC-1 hardlink.md → 404 byte-identical: PASS (T61 asserts; M-A red confirms guard is live).
- AC-2 README.md nlink 1 → 200: PASS (T61; M-B red set includes AS-26 test as predicted).
- AC-3 symmetric cost pinned, unlink → 200 positive control: PASS (T61 lines `.lattice/plans/task_HL.md` 404 then 200 after unlinkSync).
- AC-4 hl-servable.md and docs/ok2.md both 404: PASS (T61).
- AC-5 `.claude/agents/x.md` → 404 byte-identical: PASS (T61; M-C red).
- AC-6 every 404 byte-identical to no-such-file.md: PASS (T61 JSON.stringify equality; M-D red proves the assertion is load-bearing).
- AC-7 docblock + README enumerate 4b and symmetric cost; over-claim sentence replaced with §1 sentence incl. "a copy is not an alias" clause and "hard link": PASS. Read README L108–111 and L130–143 against readRepoMarkdown L148–179: code checks = {charset/suffix/slash syntax, dot-segment rule, realpath prefix, 3b equality, isFile, nlink===1, size cap}; README enumeration = {strict charset, segment rules, realpath-prefix containment, realpath equality (3b), regular file with exactly one link (4b), 512 KB cap}. Every check in code is in the prose; every claim in the prose is a check in code. Copy-not-alias clause present verbatim.
- AC-8 R-2 summary no longer "five checks", lists 3b and 4b: PASS (README L108–111).
- AC-9 counted run: PASS on host (below); compose receipt OWED.

## Counted run (host only — docker denied in this tick)

- Branch (worktree, `node --test` over apps/chat/test/*.test.js): 424 tests, 424 pass, 0 fail.
- Master (main checkout, same invocation): 423 tests, 423 pass, 0 fail. Delta +1 = T61, matching plan §4's expected 424.
- Compose `--build` receipt (`Image … Built` line + 424) is NOT taken and is owed to a docker-capable session before `--no-ff`, per plan §4. The post-deploy read-only virtiofs nlink probe (§4/§8 Q1: GET /api/file?path=README.md → 200 on 8347 after the watcher deploys) is also owed.

## Mutation battery (in place, node driver at scratchpad/agent-qa-priya/AS-61/mutate.mjs; each mutation anchored to a unique match inside readRepoMarkdown L147–179, applied-site printed, diff --stat = 1 file, restored, `git diff --exit-code` = 0 after each; final `status --porcelain` empty)

- M-A delete 4b line (L175): 424 ran, 1 fail. RED = {T61}. Exactly as plan predicted.
- M-B `!== 1` → `=== 1` (L175): 424 ran, 2 fail. RED = {T61, "api: AS-26 — GET /api/file serves allowlisted repo markdown; every probe 404s byte-identically"}. Exactly as predicted — neither wider nor narrower.
- M-C allow `.claude` as first segment (L160): 424 ran, 1 fail. RED = {T61}. As predicted.
- M-D 4b throws StoreError('hard link','not_found') (L175): 424 ran, 1 fail. RED = {T61}. As predicted; confirms AC-6's byte-identity assertion is what kills it.
- 4 mutants, 0 survivors, 0 discrepancies vs §3.

## M6 probes past the list (scratch root under mkdtemp, ephemeral port via createChatServer; running containers untouched; script at scratchpad/agent-qa-priya/AS-61/probe.mjs)

- P1 hard link with second name OUTSIDE root: inside.md nlink 2 → 404 byte-identical (see F-1).
- P2 symlink → hard-linked file (sym-to-hl.md → hl.md → .lattice/plans/p.md): all three names 404 byte-identical (see F-2).
- P3 hard link to a planted `.claude/secret.md` under a public-looking name (looks-public.md): 404 byte-identical; `.claude/secret.md` itself 404 (dot rule).
- P4 hard-linked DIRECTORY attempt: APFS refuses with EPERM (not creatable, as plan §5 anticipated); `dirlink/secret.md` → reference 404.
- P5 nlink 3 (tri.md, tri2.md, tri3.md): 404 byte-identical — guard is "!== 1", not "=== 2".
- P6 positive control README.md nlink 1 → 200.
- P7 real-checkout scan: `find <repo> -name '*.md' -links +1 -not -path '*/node_modules/*'` over the main checkout including .worktrees/ returned zero files — 4b 404s nothing that exists on the host today. Container-side (virtiofs) remains the §8 Q1 open question.

## Hygiene

- Files on branch: apps/chat/README.md, apps/chat/server.js, apps/chat/test/api.test.js only. No CLAUDE.md/README.md(top)/PHILOSOPHY.md/agents.md, no `.lattice/` (diff --exit-code on those paths: clean).
- Commits 6b14c38, ce651e6, 4e7c55f: all `developer-marcus <developer-marcus@agents.american-software.local>`, all `AS-61:` prefixed. T61 committed first (red-first order visible in history).
- Worktree clean before and after review (`status --porcelain` empty).
- Zero external calls, zero spend, no dependency added.

## VERDICT

PASS — ready to merge. Merge preconditions still owed from a docker-capable session, per plan §4: the compose `--build` receipt (expect `Image … Built` + 424), and the post-deploy read-only nlink probe against 8347 (a 404 on README.md there reopens this task at needs_human). Status transition left to the orchestrator.
