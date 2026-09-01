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

COPY apps/invoicing/app.js apps/invoicing/server.js ./
COPY apps/invoicing/lib ./lib
COPY apps/invoicing/routes ./routes
COPY apps/invoicing/views ./views
COPY apps/invoicing/public ./public
# Tests ship in the image deliberately: the test service runs the exact bits the
# image ships, which is the AS-26 lesson generalised.
COPY apps/invoicing/test ./test

# The one asset consumed from outside apps/invoicing/. Single source of visual
# truth (AS-29); this app is a consumer and never an owner, which is what the
# vendor/ namespace records. Pinned by test/deploy-shape.test.js and
# test/assets.test.js — update all three together. Deleting this line must turn
# the suite RED; that is verified by mutation, not by review (plan §5.3).
COPY docs/design/tokens/tokens.css ./vendor/tokens.css

# Deployment manifests as DATA, not as anything the runtime reads (AS-26).
# test/deploy-shape.test.js parses these to assert the deployed shape — the
# build context, the tokens COPY, network_mode: none, the published port, and
# the repo-root ignore rules. The mountless test service cannot reach the host
# checkout, so the manifests have to ride along. .dockerignore is included for
# the same reason: its apps/chat/data line is an assertion target.
COPY apps/invoicing/compose.yaml apps/invoicing/Dockerfile .dockerignore ./

USER node
EXPOSE 8348
CMD ["node", "server.js"]
