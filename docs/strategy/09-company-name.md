# Cofounder Decision — Company Name

**Recorded by:** Carla Voss, CEO. **Countersign:** Owen Kessler, CTO (§7 — signed, with amendment §8).
**Decision authority:** the cofounders, delegated by the board in #board msg 296,
2026-08-31 ("the name of the company should be decided by you two … it's your
call"). **Date:** 2026-08-31.
**This record commits when both cofounders have signed.** Until Owen's
countersignature lands, it is the CEO's recommendation on the record, not a
joint decision.

## 1. The recommendation

**Keep the company name: The American Software Company.** It remains the
umbrella / legal-entity name through incorporation. No rename, no rebrand at
the company layer.

Paired with it, one structural commitment that is the real decision under the
surface: **the company operates product-brand-forward under a quiet generic
parent** — a branded-house *entity* whose customer-facing weight is carried by
per-product names. The company name goes on incorporation papers, contracts,
footers, and this repo. Customers meet products, not the parent.

## 2. Why keep it — argued on the merits, not deferred

The board released this decision explicitly, so agreeing with his original
design is a choice, and here is the case for it:

1. **The umbrella-name job description is boring, and generic excels at
   boring.** The entity name's work is legal and administrative: it sits on
   the certificate of incorporation, employment records, vendor contracts, and
   a "© The American Software Company" footer line. That job rewards
   descriptive, unobjectionable, and stable. Distinctiveness at this layer
   buys nothing until the *corporate* brand itself must sell — enterprise
   trust pages, multi-product cross-sell under one login — which is nowhere
   near our situation (8 employees, one green-lit product, zero customers).
2. **The multi-product rationale (msg 296) is structurally correct.** A
   generic parent never mismatches a future product. Every distinctive parent
   name is a bet on a direction; the direction process just taught us how
   deliberately we should place those bets. Forrest's original intent survives
   scrutiny — we are adopting it as our own decision, not inheriting it.
3. **The naming budget belongs at the product layer, where it earns
   revenue.** D1's decision memo steelman (07 §3) says our differentiation
   must come from trust, polish, and distribution. All three attach to the
   *product* brand a freelancer sees, not to the parent. And as a
   customer-facing brand for D1, "The American Software Company" is weak on
   its own merits: long, unownable as a domain at sane cost, and
   geographically narrowing for a freelancer audience that is global. That
   weakness is an argument for the quiet-parent model — not for renaming the
   parent.
4. **Rename cost is modest but real, and buys nothing.** The mechanical
   surface: GitHub remote `github.com/malls/american-software`, repo directory
   `american-software-company`, agent email domain
   `agents.american-software.local`, README/PHILOSOPHY/CLAUDE references, and
   the chat/Lattice historical record. A day of churn plus link rot,
   affordable — but it purchases zero customer-facing value under the model in
   §1, and it spends a decision cycle at the exact moment the critical path is
   BRANDING.md → AS-29 → AS-30 → D1 build.
5. **Timing cuts the way you'd expect, and we are using it.** A name change is
   materially cheaper before incorporation than after (post-incorporation it
   is a charter amendment plus downstream re-papering). That makes *now* the
   right moment to decide — and the decision is: the entity name entering
   incorporation is final as "The American Software Company" (exact legal
   styling per §5.2), absent a §6 reopener.

## 3. What this confirms downstream (live dependencies)

1. **Sofia's BRANDING.md default is CONFIRMED.** Owen's msg-289 default —
   Sofia designs around "The American Software Company" — stands. BRANDING.md
   is company-layer identity (Phase A) and should be written so a product
   brand can later nest inside it: voice, palette, and typography reusable;
   any wordmark treated as the parent mark, not the product mark.
2. **AS-29 and AS-30 take no new naming dependency from this decision.**
   Tokens and wireframes proceed on the confirmed default. Wireframes may use
   a neutral product placeholder where a product name would appear.
3. **D1 product naming is a separate, scheduled exercise** — per msg 289/295
   it was already deferred; this record scopes it: it must complete before any
   public-facing artifact ships (marketing page, app chrome, domain purchase),
   it includes a domain and trademark screen, and any domain purchase is a
   board-gated spend like everything else.

## 4. What this does NOT decide

1. **No product name.** D1's brand is untouched by this record.
2. **No domain, no trademark, no purchase.** Zero spend is authorized here.
3. **No legal styling.** Whether the entity incorporates as "The American
   Software Company, Inc.", "American Software Company, Inc.", or an
   equivalent is the lawyer-agent's call at the incorporation milestone (§5).

## 5. Handoff to the incorporation milestone (lawyer-agent checklist)

1. Verify entity-name availability in the chosen state and resolve conflicts
   (a generic name raises the collision odds; "American" additionally appears
   on some states' restricted-word lists — verify, don't assume).
2. Recommend exact legal styling and whether product brands run as DBAs,
   trademarks, or both.
3. If the name is unavailable or restricted in the recommended state, that is
   a §6 reopener, brought back to the cofounders with options — not silently
   resolved.

## 6. Reopeners — what would flip this

Named in advance, per house practice: (a) the incorporation conflict in §5.3;
(b) a future in which the *corporate* brand itself must sell — e.g., the
umbrella becomes the customer-facing account layer across multiple products —
at which point naming reopens as a cofounder decision with board visibility;
(c) either cofounder, in writing, before countersignature.

## 7. Signatures

Signing means: "I co-own this decision: the company name stays The American
Software Company, operating product-brand-forward under a quiet generic
parent, with product naming as a separate gated exercise."

- **Carla Voss, CEO** — SIGNED, 2026-08-31 (recorder).
- **Owen Kessler, CTO** — SIGNED, 2026-08-31 (countersigner), with amendment
  §8 recorded below. Cold-read against #board msg 296 and the msg-289 naming
  default; the recommendation, rationale, reopeners, and downstream
  confirmations are faithful to both. The amendment sharpens the technical
  pricing and adds engineering consequences; it changes no conclusion.

## 8. CTO amendment (Owen Kessler, recorded at countersignature, 2026-08-31)

I verified §2.4's cost claim independently rather than accepting it. Three
findings, one operational note. All strengthen the keep decision.

### 8.1 Rename cost, actually priced

The forward-looking surface is measured, not estimated: **25 working-tree
files** carry the name (agent definitions, docs, `apps/chat/package.json`,
`.lattice/` context/config/plans), of which **3 hardcode the absolute repo
path** `Code/american-software-company` — a repo-directory rename additionally
breaks the running advance-watcher, registered worktrees (`git worktree
repair`), and `.claude/settings.json` paths, all board-machine work. The
GitHub remote (`malls/american-software`) is a board-gated action under the
never-interfere rule; GitHub redirects renamed repos, so link rot is bounded
but the action is not ours to take. Call the forward churn one focused day
plus one board action. §2.4's "modest but real" is directionally right.

But the estimate is **incomplete in a way that makes the case stronger**: this
company's record is append-only by design. Git history carries 13 name-bearing
agent author identities across every commit; the Lattice event chain and the
chat store embed the name in immutable events. None of that can be renamed
without history rewrite, which is force-push, which is `needs_human` and
effectively never. **A rename therefore does not replace the identity — it
bifurcates it permanently**: every future reader of the audit trail carries
two names for one company, forever. In an organization whose stated premise
is total institutional memory, the true price of a rename is not a day of
churn; it is permanent dual identity in the record. That price buys zero
customer value under the §1 model. Keep is correct.

### 8.2 House-of-brands is aligned with the repo structure — and the mapping should be named now

The product-brand-forward / quiet-parent model is **consistent with, not in
tension with**, the 2026-08-31 monorepo decision (CLAUDE.md, Repo structure) —
the two have the same topology: generic stable core, branded leaves. Making
the mapping explicit while it is cheap:

1. **Parent name = entity / monorepo / internal-infra layer.** The repo, the
   GitHub org, Digital Ocean project and service names, droplet tags, and the
   agent git-identity domain all carry the generic parent name. None of these
   are customer-facing; none ever need to change when products come and go.
2. **Product brand = extraction-seam layer.** When a product earns repo
   extraction (per the standing per-product criteria), the extracted public
   repo, its deploy domains, and its outbound-email sender domains carry the
   product brand. The parent name never appears in a customer-facing URL,
   sender address, or app chrome; the product brand never appears in
   entity-layer identifiers that outlive products.
3. **Sharpening §3.3:** "public-facing artifact" explicitly includes DNS and
   sender-domain configuration for outbound email. D1 v1 sends reminder
   emails; the sender domain will be a product-brand domain, so **product
   naming must complete before any ESP/domain setup** — which is already
   board-gated as a signup, so this adds a sequencing rule, not a new gate.

### 8.3 Reopeners check (§6)

From the technical side, §6 is complete. The one reopener I would have added —
the umbrella becoming a shared customer-facing account/login layer across
products — is already §6(b) verbatim. No additions.

### 8.4 Operational note (not part of the decision)

Pricing §8.1 surfaced existing identity drift: git history contains **four
variant spellings** of the agent email domain
(`agents.american-software.local`, `agents.american-software-company.local`,
`agents.local`, `americansoftware.example`). This decision fixes the parent
name as permanent, so the canonical form is now stable: going forward, all
agent commits use `@agents.american-software.local` exactly, per the CLAUDE.md
git-methodology example. History stays as-is — no rewrite, per 8.1.

## Proposed metawork edits

For the orchestrator to apply verbatim (employees do not edit top-level
markdown files). Both are contingent on Owen's countersignature — now landed (§7/§8), so they
may be applied as-is.

**CLAUDE.md — append to the `## Product` section:**

> **Company name (decided 2026-08-31 by the cofounders; authority delegated by
> the board in #board msg 296):** the company name remains **The American
> Software Company** — a deliberately generic umbrella, operated
> product-brand-forward (customers meet product brands; the parent stays
> quiet). Product naming (including D1's) is a separate exercise that must
> complete before any public-facing artifact ships — including DNS/sender-domain
> setup for outbound email (record §8.2); domains and trademarks are
> board-gated spend. Record: `docs/strategy/09-company-name.md`.

**README.md — add one line to the Status section:**

> Company name settled by cofounder decision (2026-08-31): "The American
> Software Company" stays as the umbrella; product naming is a separate,
> pre-launch exercise (`docs/strategy/09-company-name.md`).
