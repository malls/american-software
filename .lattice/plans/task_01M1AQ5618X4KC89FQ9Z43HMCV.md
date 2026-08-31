# AS-27: Chat: surface advance-loop status in the UI — active loop / single tick in flight / idle

Source: board DM msg 226 (2026-08-30 21:31, human:forrest -> cto-owen): 'also we should surface loop status on the chat UI here. whether it's active, one tick, or off.'

Goal: the chat app UI (apps/chat) shows, at a glance, which of three states the company loop is in:
1. Loop active — a /loop /advance session is running (continuous ticks).
2. Single tick in flight — one /advance tick is currently executing.
3. Off/idle — nothing running.

Known signal sources (starting points, not a design):
- apps/chat/data/advance.lock — present while a tick is in flight; contains pid/source/startedAt/nonce. The 'source' field may distinguish loop-driven vs watcher/one-off ticks.
- Watcher process state under apps/chat/watch/ (advance-watcher.mjs) — whether the watcher is alive affects what 'off' means.
- Consider staleness: a lock left behind by a dead pid should not read as 'active' (check pid liveness or startedAt age).

Design specifics (polling vs push, where the indicator lives in the UI, how loop-vs-tick is distinguished) are left to the planning stage. Task created on behalf of the board from the DM channel.
