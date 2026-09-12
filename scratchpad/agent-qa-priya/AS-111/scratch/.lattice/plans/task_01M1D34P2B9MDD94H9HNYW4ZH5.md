# AS-47: D1 v1 UI: contract screens 6-7 (create, detail with print/download)

Two screens: contract create (pick the template, pick or inline-create the client, fill the declared variables) and contract detail (view the generated contract, print or download it). Built to AS-30's wireframes and states ledgers, consuming the AS-29 tokens (docs/design/tokens/tokens.css).

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 rows C-20 (contract create screen) and C-21 (contract detail screen and the v1 delivery artifact); section 4.3 screens 6 and 7 of 7.

DECISION CONTEXT. Merged as one task with a written justification (milestone plan section 8.2): one reviewable claim — "a freelancer can generate a contract and hand it to a client" — at around 450 projected lines. v1's contract DELIVERY IS FREELANCER-MEDIATED: the detail screen must produce a clean printable and downloadable document that the freelancer sends through their own email client, because a client-facing share link (row C-22) and any email sent by us (row C-48) are both out of v1. That is the honest consequence of having no ESP and no sender domain, and it is why this screen's print view is a functional requirement rather than a nicety.

The rendered contract carries the CC BY 4.0 attribution line and the visible placeholder marking produced by the contract-generation task. Do not style either away: the placeholder marking is a legal gate (adapted template text must not reach a real user before the lawyer-agent review clears), not a design blemish.

VERIFICATION: states ledger exercised — empty, variable validation errors, generating, generated, print view; the print stylesheet produces a readable single document; renders at 375px before desktop; tokens only, no magic values.

NOT IN THIS TASK: the template registry or generation logic (the contracts task); any public or client-facing contract route (row C-22, OUT — Rule 1); acceptance capture or e-signature (rows C-23 and C-24, OUT); a contract PDF renderer of our own (row C-25, OUT — the browser's print-to-PDF is v1's answer, and the spike already measured that building one is cheap and still unnecessary).
