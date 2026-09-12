# Board Decision — Step 5 of 5: D1 Green-Lit

**Recorded by:** Carla Voss, CEO. **Countersign:** Owen Kessler, CTO (§6).
**Decision authority:** Forrest, board. **Date:** 2026-08-31.
**This record commits.** It closes the five-step direction process opened in
#board msg 117 and documented in docs/strategy/01–07.

## 1. The decision, verbatim

> "I'm greenlighting this product"
> — human:forrest, #bizdev msg 290, 2026-08-31T15:04:05Z

Posted in direct response to the step-4 decision memo (07-decision-memo.md,
delivered verbatim to #board as msg 273), whose sole recommendation was
**Candidate D1 — freelancer invoicing/contract automation**.

## 2. What this decides

1. **The company's business is D1: freelancer invoicing/contract automation.**
   The direction process (steps 1–5) is complete. Product selection is settled
   by board decision, not merely recommended.
2. **The fallback ordering (07 §5: C2, then D4) is retired as a selection
   mechanism.** C2 and D4 return only via a new, board-sanctioned decision
   process, not automatically.
3. **The step-5 gate on product-specific work is lifted.** Concretely: AS-30
   (product core-loop UX) leaves `needs_human`; D1 technical scoping begins.

## 3. What this does NOT decide — the three §4 items, with operative defaults

The green-light was four words and answered the product question. The CEO's
reading of the three §4 asks, stated as defaults the board can correct by
exception (posted as such in #bizdev; silence sustains the defaults):

1. **Warm intros (§4.1) — still open, still the board's action.** Demand
   validation via 3–5 warm freelancer intros remains outstanding. Its role
   changes with the green-light: it is no longer a selection gate (the board
   has decided) but a **build-shaping input** — pricing, positioning, feature
   priority, and the first-user pipeline. The interviews run when the intros
   arrive; the build does not block on them. Adverse findings no longer
   auto-withdraw anything, but they go to the board promptly with a
   recommendation — the 07 §3 steelman stays on the record either way.
2. **Revenue rail (§4.2) — unanswered; default holds.** Until the board rules
   on whether a Stripe application fee is clean under constraint 7,
   **subscription-only is the operative model** (strictest-clean, per the
   memo's stated default). All product and pricing work proceeds on
   subscription-only; no application-fee code paths are built.
3. **Incorporation (§4.3) — a separate coming milestone, not started by this
   record.** It gets its own lawyer-agent process at company level
   (non-Lattice, per scope rules), brought to the board framed with a
   recommendation. Standing rule unchanged: every processor/ESP/carrier
   signup is board-gated regardless of price. First expected ask, per the
   memo: the **free Stripe test-mode account**, which will come as an
   explicit board request when engineering reaches it — it is not requested
   or opened by this record.

## 4. What the green-light unblocks (actions taken with this record)

1. **AS-30** (`Product core-loop UX`) — `needs_human → backlog`, gate
   satisfied by #bizdev msg 290; still `depends_on` AS-29 (design tokens,
   itself gated on BRANDING.md). Sequencing unchanged: BRANDING.md → AS-29 →
   AS-30.
2. **D1 technical scoping task created** (Lattice, on behalf of the board):
   the CTO owns converting the D1 spike record (docs/strategy/spikes/) into a
   scoped v1 milestone plan and right-sized build tasks. This record
   deliberately does not invent that plan — scoping is technical-domain work.
3. **No spend is authorized by this record.** Zero purchases, zero external
   signups. Every future spend of any size routes through the board.

## 5. Falsifier disposition, for honesty of the record

07 §3 named a falsifier: "if validation says the band's occupants already
serve these buyers well, this recommendation is withdrawn." The board
green-lit before validation ran. That is the board's prerogative and is
recorded as such; the cofounders' obligation transforms accordingly — from
*withdraw the recommendation* to *report adverse validation results to the
board with a recommendation, promptly and in writing*. The risk statement in
07 §3 (occupied band, symmetric ease, distribution as the real
differentiator) is carried forward into build planning, not archived.

## 6. Signatures

Signing means: "This record faithfully transcribes the board's step-5
decision and its scope; the stated defaults for the open §4 items are as
posted to the board; the decision itself is the board's and requires no
cofounder consent."

- **Carla Voss, CEO** — SIGNED, 2026-08-31 (recorder).
- **Owen Kessler, CTO** — SIGNED, 2026-08-31. Cold-read against the source:
  #bizdev msg 290 is transcribed verbatim and in context (it answers msg 273,
  the step-4 memo, whose sole recommendation was D1), and §3's three defaults
  match 07 §4's open items one-for-one. Two things I want on the record as
  the technical signatory, neither of which changes my signature:
  (a) subscription-only (§3.2) is the assumption all D1 scoping is built on,
  and it gets structurally cheaper to reverse the earlier the board rules on
  constraint 7 — a ruling before the v1 milestone plan lands is worth
  materially more than one after; (b) §5's carried-forward risk (occupied
  band, symmetric ease, distribution as the real differentiator) is a build
  constraint I own, not an archived caveat — it belongs in the v1 scope as an
  explicit assumption with a falsifier, and I will carry it into AS-31 rather
  than into a later post-mortem.
