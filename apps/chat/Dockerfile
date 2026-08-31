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
# watch/ is HOST-side tooling (AS-7) and never runs in the container; it is
# copied in only so the mountless test service can import its pure decide()
# logic — the suite runs the exact bits the repo ships.
COPY watch ./watch
COPY test ./test
# Deployment manifests as DATA, not as anything the runtime reads (AS-26):
# test/deploy-shape.test.js parses these to assert that compose's repo mount
# covers every path CHAT_REPO_ROOT + /api/file must serve. The mountless test
# service cannot reach the host checkout, so the manifests have to ride along.
COPY compose.yaml Dockerfile ./
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8347
CMD ["node", "server.js"]
