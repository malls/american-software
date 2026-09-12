# apps/invoicing image (AS-37).
#
# BUILD CONTEXT IS THE REPO ROOT, not apps/invoicing. Every COPY path below is
# therefore repo-relative. The reason is the tokens line near the bottom: the
# single source of visual truth lives at docs/design/tokens/tokens.css, outside
# this app, and the stack decision requires it be served byte-identical with no
# second copy in version control (plan §5.3). A repo-root context is the only
# mechanism that gets those bytes into the image while keeping the mountless
# test service able to fetch them through the real serving path — and it builds
# under BOTH the BuildKit and the legacy builder, which additional_contexts does
# not. See the repo-root .dockerignore, which this context makes load-bearing.
#
# Base pinned to an exact PATCH (stronger than the decision's "exact minor"):
# `docker run --rm node:24-slim node -v` -> v24.20.0 on 2026-09-01.
FROM node:24.20.0-slim
WORKDIR /app
ENV NODE_ENV=production

# Manifest + lockfile first, so the npm layer caches across source edits.
# npm ci — NEVER npm install, which can rewrite the lockfile mid-build. The
# lockfile is what actually pins the 65 transitive packages; the two exact
# literals in package.json only pin the direct set (plan §4.4).
# Build-time network is expected and fine; it is TEST-time network that gate (c)
# forbids, enforced by network_mode: none on the test service (plan §4.5).
COPY apps/invoicing/package.json apps/invoicing/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# The app, WHOLE (AS-57). The image IS this directory minus the repo-root
# .dockerignore — never an explicit list of what to ship. An explicit list was
# a second closed world, closed over the image instead of the directory: a new
# top-level file (a compose.override.yaml with an outbound healthcheck, say)
# never reached /app, so test/dependency-policy.test.js's closed-world scan
# never saw it. Now every file here lands in the image and the scan classifies
# it or fails. What rides along on purpose: test/ (the test service runs the
# exact bits the image ships — the AS-26 lesson generalised), demo/ (AS-90, the
# board's walkthrough; server.js never imports it and dependency-policy asserts
# nothing under lib/ or routes/ does either), the manifests (below), and
# README.md (prose; UNSCANNED). Pinned by test/deploy-shape.test.js: exactly
# one COPY sources this directory, and no other COPY sources a path under it
# except the cache-layer one above.
COPY apps/invoicing ./

# The one SERVED asset consumed from outside apps/invoicing/. Single source of visual
# truth (AS-29); this app is a consumer and never an owner, which is what the
# vendor/ namespace records. Pinned by test/deploy-shape.test.js and
# test/assets.test.js — update all three together. Deleting this line must turn
# the suite RED; that is verified by mutation, not by review (plan §5.3).
COPY docs/design/tokens/tokens.css ./vendor/tokens.css
# The second and last asset from outside apps/invoicing/ (AS-71): the states
# ledger the screens are built from. Consumed by the TEST SUITE ONLY —
# test/states-ledger.test.js parses it and joins every screen's frozen ledger
# to the design document, so a row changing there turns the suite red. Never
# served, never health-checked (it is not in VENDOR_ASSETS; see
# lib/vendor.js VENDOR_DOCUMENTS). Pinned by test/deploy-shape.test.js —
# update both together. Deleting this line must turn the suite RED.
COPY docs/design/wireframes/02-states-ledger.md ./vendor/states-ledger.md

# The repo-root .dockerignore as DATA, not as anything the runtime reads
# (AS-26). test/deploy-shape.test.js parses the manifests — compose.yaml and
# this Dockerfile arrive with the whole-directory COPY above; this one lives
# outside apps/invoicing/ — to assert the deployed shape: the build context,
# the tokens COPY, network_mode: none, the published port, and the repo-root
# ignore rules (its apps/chat/data line is an assertion target). The mountless
# test service cannot reach the host checkout, so it has to ride along.
COPY .dockerignore ./

# The database directory. A fresh named volume mounted here inherits this
# ownership (measured 2026-09-01: uid 1000, mode 755, and the `node` user creates
# the WAL database in it). Without this line the volume would be root-owned and
# the first boot would fail at open with SQLITE_CANTOPEN. The `test` service
# mounts nothing here, so the suite writes to the image's own empty copy and
# never touches a developer's data.
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 8348
CMD ["node", "server.js"]
