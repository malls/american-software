# AS-42: D1 v1: contract templates and generation (server)

Chain link 3, "produces a contract for a client" — server side. A template registry with declared variable slots, substitution into a stored contract record, and a plain HTML render of the generated contract. ONE template in v1 — an independent-contractor-agreement shape — because one closes the chain and a second does not (Rule 1).

IMPLEMENTS: docs/engineering/00-d1-v1-milestone-plan.md section 3 rows C-17 (template set), C-18 (CC BY 4.0 attribution mechanism, IN by mandate) and C-19 (contract generation).

DECISION CONTEXT, INCLUDING A HARD GATE. The intended template source is Common Paper's standard agreements, whose licence the D1 spike verified verbatim from the publisher's own page as CC BY 4.0 — commercial use and adaptation permitted, with attribution (docs/strategy/spikes/spike-D1-freelancer-invoicing.md section 2). The residual the CEO's C5 flagged is still open: ADAPTED TEMPLATE TEXT MUST NOT BE SHOWN TO A REAL USER before a lawyer-agent review clears it. That review is company-level, non-Lattice work (CLAUDE.md scope) — it is a gate on this capability, not a task here, and it is owned by CEO + CTO.

So this task ships CLEARLY-MARKED PLACEHOLDER BODY TEXT: structurally complete, legally inert, visibly labelled as placeholder — while building the attribution mechanism now so the obligation cannot be forgotten when real text lands. The attribution line is exercised by the placeholder and covered by a test. Do not paste adapted Common Paper prose into this task.

VERIFICATION: unit tests — every declared variable is substituted; an unfilled required variable is an error, not a silent blank; the rendered document contains both the attribution line and the placeholder marking; generation is deterministic for identical inputs. No accounts, no network, no Stripe.

NOT IN THIS TASK: the contract screens; a client-facing share link or portal (row C-22, OUT — Rule 1: in v1 the freelancer downloads or prints the contract and sends it themselves through their own email); a recorded client acceptance event (row C-23, OUT — Rule 1; this overrides the AS-31 plan section 12 Q1 default and is recorded in the milestone plan's amendment log); e-signature of any legal weight (row C-24, OUT); our own PDF renderer (row C-25, OUT — the browser's print-to-PDF closes the chain); a second template.
