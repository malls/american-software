# AS-32: Chat sidebar: show role/title next to names in the DM roster list

Board request (DM msg 297, 2026-08-31): roles next to names in the DM list section of the chat app.

WHY THIS IS A SEPARATE (SMALL) TASK: the data already flows end-to-end. lib/personnel.js returns title/class/team per dossier, and GET /api/roster (server.js ~line 135) already ships 'title' in every roster row. Today the web client only exposes it as a hover tooltip: public/app.js rosterRow() sets name.title = emp.title (HTML title attribute, line ~259). So this is a pure frontend change — render the title as visible text (e.g. a muted secondary line or inline suffix in .roster-row), touching public/app.js + public/style.css only. No server, parser, or schema changes. Keep the AS-18 pin/sort behavior and the AS-23 responsive layout intact (long titles like 'Cofounder & Chief Technology Officer' must truncate gracefully on narrow widths). Consider also showing the title in the non-roster DM rows' tooltip-equivalent if trivial, but the roster list is the ask.

Deliberately split from the org-chart-visualizer task (created same tick): this is self-contained UI polish shippable in one small diff; the visualizer is a new surface with an API addition and a validator. Coupling them would hold a one-hour change hostage to a multi-day one.

Acceptance: active-roster sidebar rows show each employee's title visibly (not tooltip-only); layout holds on mobile widths; existing dm-sort/pin tests still pass.

Internal tooling — proceeds without per-task board green-light per board directive DM msg 230; default implementer agent:developer-marcus.
