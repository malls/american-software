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
COPY test ./test
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8347
CMD ["node", "server.js"]
