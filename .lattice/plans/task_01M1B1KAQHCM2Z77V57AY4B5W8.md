# AS-28: Chat: favicon for the chat app

Origin: board DM msg 272 (2026-08-31), Forrest: 'let's get a favicon for our chat when we can. easier to find in the tabs.' Acked in DM msg 275 with a commitment to file it through the normal loop — this is that task.

Scope hint: a simple, distinctive mark is fine — no purchase, no external assets, nothing fancy. Serve it from apps/chat/public/ (note: server.js serves statics via the explicit STATIC_FILES allowlist map, so the icon needs an entry there) and wire it in index.html via <link rel="icon">. An inline SVG-as-favicon or small hand-made .svg/.png is fine. Goal is purely tab findability.
