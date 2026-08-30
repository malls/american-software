# AS-9: Chat: query-string URL state — current channel/DM/thread survives refresh, links shareable

Board request via DM (chat msg 59, human:forrest): "I think we need query string to keep page context in here. also, the lattice events should link to the lattice site" — this task is the first half (query-string page context); the dashboard-link half is tracked separately.

Problem: apps/chat/public/app.js keeps all selection state (current channel/DM, open thread) in memory only. A refresh drops the user back to 'Select a conversation', and there is no way to share a link that opens a specific channel, DM, or thread.

Scope: encode page context in the URL query string (e.g. ?conv=...&thread=...) — update it on selection (history.replaceState/pushState, no full navigations), restore it on load after identities/conversations arrive, and reconcile with the existing location.hash msg-anchor behavior in openThread/closeThread (fold it in or keep it compatible; planner's call). Constraint: identity must NOT go in the URL — 'me' stays in localStorage ('chat.me'); a shared link must never switch the viewer's identity. Unknown/stale params fail soft to the current default view. Key file: apps/chat/public/app.js (init, selectConversation, openThread, closeThread); no server changes expected.
