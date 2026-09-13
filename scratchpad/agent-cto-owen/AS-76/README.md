# AS-76 evidence — how to reproduce every number in the design note

The note is `docs/engineering/04-observability-posture.md`. Every figure it quotes
comes from one of the three scripts here. All three are read-only, offline, and take
under a second. Run them from anywhere (paths inside are absolute):

```
node scratchpad/agent-cto-owen/AS-76/footprint.js     # -> footprint.txt   (note §3.1)
node scratchpad/agent-cto-owen/AS-76/inspect.js       # stdout only        (note §3.2)
node scratchpad/agent-cto-owen/AS-76/throw-sites.js   # -> throw-sites.txt (note §4.3)
```

## `footprint.js` — stack decision §11 rule 4

Resolves the `@sentry/node` and `posthog-node` dependency closures **offline**, then
compares them against `apps/invoicing/package-lock.json`.

Why not `npm ls --all --parseable | wc -l`, which is what rule 4 actually says: the
session that produced this note had no network and no `npm`, so a real install was not
possible. Method used instead — the local npm cache (`~/.npm/_cacache`) already held
both tarball trees; the script reads the cacache index, computes each entry's
content-addressed path from its integrity hash, gunzips the tarball, extracts
`package/package.json` with a minimal ustar reader, and walks the `dependencies`
closure from each root, resolving every name to the highest cached version.

**This is a substitute method, so it carries its own validation.** The script
re-derives the app's own footprint by the same walk and prints it next to the figure
recorded in `docs/engineering/01-stack-decision.md` §13 amendment 8. If those two
disagree, the method is wrong and the SDK numbers are void. They currently agree on
all four figures (69 instances, 67 distinct `name@version`, 66 distinct names,
63 MIT / 4 ISC / 1 Apache-2.0 / 1 BSD-3-Clause instance-level).

**Known limits, all of which err low** — so the SDK counts are a floor, never a
ceiling:

1. `@types/estree` (required by `@apm-js-collab/code-transformer`) is not in the cache,
   so the Sentry closure is reported as 32 and is really ≥33.
2. `optionalDependencies` and `peerDependencies` are not walked. `@sentry/node-core`
   peer-depends on five OpenTelemetry packages, one of which
   (`@opentelemetry/exporter-trace-otlp-http`) is not in the closure above.
3. npm's real resolver may hoist or duplicate differently than a simple closure walk.

**Reproduction caveat.** The script depends on the two tarball trees being present in
`~/.npm/_cacache`. On a machine where they are not, it will report the roots as
unresolved rather than produce a wrong number. Open question Q5 in the note asks for
these figures to be confirmed with a live `npm ls` on the first tick that has network;
the note's argument (§3.2) does not depend on the count, which is the point of stating
the floor rather than a precise value.

## `inspect.js` — what is actually inside the tree (note §3.2)

Prints the manifest of each load-bearing package in both closures: description,
licence, direct/optional/peer dependencies, engines, and any install / preinstall /
postinstall script. This is the source for three claims in the note:

- `@sentry/node`'s own description names OpenTelemetry, and it directly depends on
  `import-in-the-middle` ("Intercept imports in Node.js");
- `@apm-js-collab/code-transformer` depends on a JavaScript parser (`meriyah`) and a
  source generator (`astring`) — i.e. a load-time source-rewriting pipeline;
- **no package in either tree declares an install script.** The note says so
  explicitly, because removing a hazard people assume is what lets the decision rest on
  the hazard that is actually there.

## `throw-sites.js` — the error-message census (note §4.3)

Counts `throw new *Error(` sites in `apps/invoicing` app source (top-level `test/`,
`vendor/`, `demo/`, `node_modules/` skipped, mirroring the dependency-policy walker),
how many interpolate a runtime value into the message, and which of those interpolate
something the note's deny-list names.

Current output: **185 sites · 60 interpolating · 10 deny-listed**, of which the two
that decide the ruling are `lib/db/repositories/clients.js:117` and
`lib/db/repositories/invoices.js:243` — both interpolate a Stripe object id into an
error message.

Detection is line-oriented, so a `throw new` split across lines is not counted. That
undercounts, which is the safe direction for a claim of the form "at least this many".
Do not "fix" it into a whole-file scan without also re-reading the note's wording: the
argument is a floor, and a floor computed by a stricter method stays valid.
