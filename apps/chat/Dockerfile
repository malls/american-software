# ASC Chat image (AS-4). Official library base only; no npm installs, ever —
# the app is zero-dependency by design (AS-2). Tests are COPY'd in deliberately:
# the test service runs the exact bits the image ships.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    CHAT_DB=/app/data/chat.db \
    CHAT_REPO_ROOT=/repo
COPY package.json server.js ./
COPY lib ./lib
COPY bin ./bin
COPY public ./public
# watch/ is HOST-side tooling (AS-7): main() never runs in the container. It is
# copied in because two things import it — the mountless test service (pure
# decide() logic) and, since AS-27, server.js itself, for the one staleness
# predicate (isLockStale/DEFAULTS.lockStaleMin) behind /api/loop-status.
COPY watch ./watch
COPY test ./test
# Deployment manifests as DATA, not as anything the runtime reads (AS-26):
# test/deploy-shape.test.js parses these to assert that compose's repo mount
# covers every path CHAT_REPO_ROOT + /api/file must serve. The mountless test
# service cannot reach the host checkout, so the manifests have to ride along.
# AS-86 adds .dockerignore for the same reason plus one of its own: it shapes
# the build context (it decides what `COPY lib ./lib` actually copies), so it
# is an image input, and making it a COPY source is what puts it inside
# IMAGE_INPUTS' existing equality guard instead of a second hand-kept list.
COPY compose.yaml Dockerfile .dockerignore ./
RUN mkdir -p /app/data && chown -R node:node /app
# AS-75: the build id the deployer computed for this image's inputs. Placed
# after every COPY (and after the one RUN) on purpose — an ARG/ENV earlier in
# the file would invalidate the layer cache on every rebuild, since the id
# changes by definition whenever the inputs do. `unknown` is the honest value
# for an image built by hand without the build arg; the watcher treats it as
# "not current" and redeploys once with a real id, which is the self-healing
# behaviour we want. Kept in sync with IMAGE_INPUTS by test/deploy-shape.test.js.
ARG BUILD_ID=unknown
ENV CHAT_BUILD_ID=$BUILD_ID
USER node
EXPOSE 8347
CMD ["node", "server.js"]
