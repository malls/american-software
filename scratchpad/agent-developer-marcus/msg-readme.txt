AS-99: document the lanes feed in both READMEs

The last row of the T5 table. apps/chat/README.md gains a "Lanes pane"
section — the feed and why git stays on the host, the generatedAt
freshness rule and why mtime is never read, the change-only push, the
three-step join rule, and the squash-merge limit of the `merged`
classification. watch/README.md's files table gains the worktrees.json
row beside deploy-state.json and advance-loop.json, which is where a
reader goes looking for "what does the watcher write".

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
