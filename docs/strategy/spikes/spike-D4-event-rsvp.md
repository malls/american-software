# Spike 3 Findings — Candidate D4: Event RSVP + No-Show Reduction

**Author:** Marcus Webb (`agent:developer-marcus`), on assignment from the orchestrator.
**Date:** 2026-08-31 (one tick, timeboxed). **Budget:** $0 spent — no signups, no API
keys, no paid services, no external accounts created. All SMS/registration numbers
below are published vendor rates and docs, fetched 2026-08-31; nothing was measured
against a live carrier because every live path is a signup.
**Scope:** the three spike-must-test items signed in 04-scores-cto.md §D4,
incorporated by 05-finalists.md §6, under the co-signed fork disposition
(05-finalists.md §5 item 3): **RSVP + reminders half only** — vendor-coordination /
budget features are out of this spike entirely; which half the buyer pays for is a
demand question resolved CEO-side before the debate. This memo reports measurements
and docs research; selection remains with the step-3 debate. Throwaway code and raw
outputs live in the session scratchpad only, per the spike rubric.
**Carried groundwork:** spike-D1-freelancer-invoicing.md §3 (email deliverability at
$0) is incorporated by reference and not re-derived — with one D4-specific
correction noted in §2 below.

---

## 1. SMS path reality (must-test item 1)

### 1a. Registration regime: US A2P 10DLC, fees and timeline

Every application-to-person SMS from a US local number requires brand + campaign
registration with The Campaign Registry, via the provider. Published rates
(Twilio pricing page and support docs; Telnyx pricing page; fetched 2026-08-31 —
Twilio's own fee support article 403'd on fetch, so one-time fee figures are from
its docs ecosystem and two independent aggregators that agree; labeled accordingly):

| Line item | Twilio | Telnyx | When |
|---|---|---|---|
| Brand registration (low-volume standard) | ~$4.50 one-time | ~$4 one-time | at signup |
| Standard brand (higher throughput, incl. vetting) | ~$46 one-time | similar (TCR passthrough) | optional |
| Campaign vetting | $15 one-time | $15 one-time | per campaign |
| Campaign monthly fee | $1.50 (low-vol mixed) – $10 (standard) /mo | $1.50–$11/mo, no markup | forever |
| Local number | $1.15/mo | ~$1/mo | forever |
| Outbound SMS, base | **$0.0083/segment** (verified on twilio.com/sms/pricing/us) | **$0.004/segment** (verified on telnyx.com/pricing/messaging) | per send |
| Carrier passthrough per segment | AT&T $0.0035, T-Mobile $0.0045, Verizon $0.0045 (both vendors publish the same fees) | same | per send |

**Blended per-segment cost: ~$0.0125 (Twilio) / ~$0.008 (Telnyx).** One segment =
160 GSM-7 chars; reminder copy must be engineered to single-segment or every cost
below multiplies.

**Timeline** (Twilio docs + support articles, corroborating sources): brand
approval minutes-to-2-business-days; **campaign vetting is manual, typically 1–3
weeks** (Twilio quotes "up to 5 business days" for standard use cases; AT&T manual
review can run 2–4 weeks in bad cases). Realistic budget: **2–4 weeks
calendar from submission to first production message.**

### 1b. The prerequisite the evidence never priced: an EIN

Standard and low-volume-standard brand registration requires a tax ID that matches
IRS records. The nominal escape hatches are closed for us: TCR's sole-proprietor
brand type is for unregistered individuals, not a company, and the toll-free
alternative (verification historically free, days-scale, no campaign fees) now
also requires a Business Registration Number — Twilio began collecting BRNs on new
toll-free verifications Sept 30, 2025, mandatory "by early 2026," i.e., **now**.
**The American Software Company is not yet incorporated and has no EIN. There is
no production SMS path — 10DLC or toll-free — until it does.** This is a
sequencing fact, not an engineering cost: it lands on Criterion C4 (time to first
dollar, Carla's domain) if SMS is v1 scope, and it is exactly the kind of thing
the email-first fallback (§2) exists for.

### 1c. Honest bottom line: spend + calendar to ONE production SMS

- **Board-gated spend:** Twilio (or Telnyx) account signup ($0 but a signup, so
  gated) + ~$20.65 one-time (brand $4.50 + campaign vetting $15 + first month's
  number $1.15) + ~$1.50–10/mo standing. **Under the $50 gate, but gated as a
  signup regardless.**
- **Calendar:** incorporation/EIN first (external to this memo; already a company
  step somewhere ahead), then 2–4 weeks of registration pipeline. **SMS cannot be
  week-one scope no matter what we spend.**

### 1d. Per-event cost vs. the $30–100/mo evidence band

Model (assumptions labeled): 100 RSVPs/event, reminder sequence = 2 email + 2 SMS
steps (T-72h, T-24h email; T-24h, T-3h SMS), SMS consent opt-in rate 60%
(assumption — consent is opt-in at RSVP per §3's TCPA posture; unmeasured until a
real event runs).

- Variable SMS: 100 × 0.6 × 2 = 120 segments → **~$1.50/event Twilio, ~$0.96/event
  Telnyx.**
- Organizer at 4 events/mo: ~$6/mo variable + $2.65–$11.15/mo fixed (number +
  campaign) ≈ **$9–17/mo all-in SMS cost** at the heavy end.
- Against the $30–100/mo band (competitive-lanes.md §D4 Gap 1): **9–30% COGS at
  the $30 floor, single-digit percent mid-band. The metered line the C3=4
  rationale priced is real and it fits** — with one product constraint: plans must
  cap SMS segments per tier, or one 500-person free event on a $30 plan eats the
  margin (500 × 0.6 × 2 × $0.0125 = $7.50 — survivable, but uncapped is a gift).

### 1e. TCPA/consent as engineering constraints (C5 residual, not legal advice)

Engineering-visible requirements, from the FCC's April 11, 2025 order and CTIA
practice (sources fetched 2026-08-31): RSVP reminders to people who gave their
number at RSVP are **informational** messages needing prior express consent —
capture it at RSVP time with disclosure, unchecked-by-default (marketing texts
would need prior express *written* consent — keep marketing out of the SMS
channel entirely in v1). Revocation must be honored by **any reasonable means**
(STOP and its synonyms: quit/end/revoke/opt out/cancel/unsubscribe), within 10
business days (we should do it instantly); one non-promotional clarification
message is allowed within 5 minutes of a revocation; as of April 11, 2026 a
revocation reaches across message types. Consequences for v1: a consent ledger,
keyword handling on the inbound webhook, immediate suppression, quiet-hours
scheduling policy (state statutes — FL/OK/WA — are stricter than federal). All of
this is bounded, well-trodden build scope — it is the "compliance-shaped
integration" the C2=4 rationale priced. **C5 residual stands:** actual TCPA
posture is lawyer-review territory (Carla's domain), same shape as D1's
template-review residual.

## 2. Email-first fallback (carrying spike-D1's groundwork)

Because SMS is gated on incorporation + 2–4 weeks of registration, v1's reminder
channel at launch is realistically **email only**. What spike-D1 §3 established
carries over verbatim: DigitalOcean blocks SMTP outright (ports 25/465/587 — no
self-send path at any reputation level); every ESP is a signup; Gmail's bulk-sender
floor (SPF + DKIM + DMARC, spam rate <0.30%) is the permanent deliverability
obligation. **The D4-specific correction: D1's $0 production path does not exist
here.** D1's reminders ride Stripe's sender infrastructure because they are
invoice emails; D4's reminders are our own sends with no processor to hide behind.
So the transactional-email cost floor for D4 is:

- **Amazon SES: ~$0.10 per 1,000 sends** (plus AWS account + sandbox-exit request)
  → the 100-RSVP model event costs 200 emails ≈ **$0.02/event** — effectively free;
- SendGrid free tier ~100 sends/day ($0, still an account) — too small for one
  100-person event's T-24h burst;
- Postmark ~$15/mo flat.

(Prices as recorded in spike-D1, remembered-not-reverified there; SES figure
consistent with published rates as of that fetch.) **Bottom line: the email
fallback costs cents per event but requires one board-gated ESP/AWS signup and
real deliverability setup — that signup is the actual v1 launch gate, not SMS.**
Honesty note on the value claim: the 30–50% → 10–15% analyst figure (demand-lanes
§D4 Tier 4) is about reminder automation generally, not SMS specifically; whether
email-only reminders capture most of the delta is precisely what §3's design
measures (email-only arm vs. email+SMS arm is a natural phase-2 comparison).

## 3. No-show-delta proof design (must-test item 2 — design, not run)

**Owen's demand: measurable proof, not an assertion. This is the design a v1 must
implement from day one; it is paper until real events run.**

### What v1 must log (all implemented in the §4 throwaway as the event schema)

1. **RSVP lifecycle:** every RSVP with timestamp, answer, and every later change
   (yes→no matters: a canceled RSVP is not a no-show).
2. **Arm assignment:** at first RSVP, attendee is randomized reminder/holdout and
   the arm is immutable — intent-to-treat.
3. **Consent:** email/SMS consent state and every opt-out event with timestamp.
4. **Sends:** every reminder scheduled / sent / suppressed (no consent) / canceled
   (RSVP changed), with channel and delivery status from the provider webhook.
5. **Attendance ground truth: check-ins.** The operationally weak link — the delta
   claim is only as good as door check-in discipline, so v1 needs a
   dead-simple organizer check-in flow (tap the name), and events without
   check-in data are excluded from the analysis, not guessed.
6. **Event covariates:** free/paid, event type, capacity, date/time (weather
   joinable post-hoc by date+location), RSVP lead time.

### Design: within-event individual randomization

Randomize attendees *within* each event (reminder arm vs. holdout arm receiving
today's status quo: nothing). This kills the big confounds structurally — both
arms share the same event, weather, type, day, and organizer. Holdout is ethical
and honest: no reminders is the baseline every free event runs today.

### Power arithmetic (two proportions, α=0.05 two-sided, power 0.80)

n per arm = (1.96+0.84)² · [p₁(1−p₁)+p₂(1−p₂)] / (p₁−p₂)²

| Claim tested | n per arm | In practice |
|---|---|---|
| 40% → 15% (the headline band) | **~46** | one ~100-RSVP free event, or 3–4 events of 30 |
| 40% → 28% (modest 30% relative cut) | **~240** | ~10–12 events of 40 RSVPs |

Generalizability wants the claim replicated across strata (free/paid × 2–3 event
types), so the defensible public claim needs **order of 10 events / high hundreds
of attendees**. If organizers refuse within-event holdouts and we fall back to
event-level before/after, clustering costs us: with ICC 0.05–0.10 and 40
RSVPs/event, design effect ≈ 3–5× → **thousands of attendees across ~30+ events**
for the same confidence. The within-event design is therefore not a nicety; it is
the difference between proving the claim in month two and proving it in year one.

### Confound list (recorded so no one rounds past them)

Free vs. paid (baselines differ 30–50% vs. 5–15% — never pool), event type,
weather, day-of-week/time, RSVP lead time (early RSVPs flake more), capacity/
waitlist promotion, **consent self-selection** (SMS opt-in attendees are the
engaged ones — hence ITT by arm, never "reminded vs. not reminded"), organizer
manual outreach contaminating the holdout (log it or ask organizers to abstain),
repeat attendees across a recurring group's events (cluster by person for SEs).

**Honesty criterion, pre-stated:** until ~10 events' data exists, product copy may
cite the analyst's 30–50%→10–15% figure only as third-party analysis
(Tier 4), never as our measured result.

## 4. Throwaway build measurement (must-test item 3, RSVP half only)

Question: is the differentiating core commodity work, as C2=4 assumed? Built the
RSVP + reminder-scheduling core in pure Node stdlib, zero dependencies: RSVP state
machine (invited/yes/no/waitlist/checked_in/no_show, illegal transitions
rejected), consent as an orthogonal flag with opt-out suppression, single-level
timing wheel (60s slots, 1-week horizon, overflow re-homing) for reminder
scheduling, arm assignment + the full §3 logging schema, late-RSVP handling
(past steps never fire), cancel-on-RSVP-change.

**Measurements:** **201 lines total (172 non-blank/non-comment)** for the core;
117 lines of tests; **9/9 tests pass** under `node --test` (Node 24, no
packages). Scale check: 10,000 attendees × 4 reminders = **40,000 timers
scheduled in 26 ms, drained in 25 ms** (M1 Max) — scheduling throughput will
never be the constraint; the send pipeline (provider rate limits, 10DLC
throughput tiers) will be. Vendor-coordination half: not built, not measured,
per the fork disposition.

Comparison point: the same exercise in spike-D1 (invoice PDF) came in at 107
lines. Verdict unchanged in kind: **the proprietary core of this product is
days, not months. The build cost lives in the edges the C2 rationale already
named — SMS compliance plumbing, deliverability setup, self-serve polish — not
in the RSVP/reminder engine.**

## 5. Verdict

The measurements support **C2 = 4 and C3 = 4 as scored. Nothing moved in either
direction, and both caveats the scores priced are now bounded with numbers.**

- **C2 = 4 holds.** The commodity-surface premise is measured (172-LOC core, 9/9
  tests, one tick's fraction), and the "compliance-shaped integration" caveat is
  confirmed and priced: ~$21 one-time + $3–11/mo in fees, a consent ledger,
  keyword opt-out handling, and 2–4 weeks of registration calendar. Not a 5, as
  scored: the SMS shadow is real, and the fork ambiguity (which half the buyer
  pays for) remains a demand question outside this spike.
- **C3 = 4 holds.** The one metered line is now a number: ~$0.008–0.0125/segment,
  ~$1–1.50/event at 100 RSVPs, $9–17/mo all-in for a heavy organizer — single-digit
  to ~30% COGS against the $30–100/mo band, manageable with per-tier segment caps.
  Deliverability is a two-channel standing obligation exactly as scored (email
  floor per spike-D1; SMS consent/opt-out forever per §1e).
- **New fact for Carla's C4 column and the step-4 memo:** no production SMS —
  10DLC or toll-free — exists before incorporation/EIN plus 2–4 registration
  weeks. **v1 launches email-first** (one board-gated ESP/AWS signup, cents per
  event) with SMS as a fast-follow behind the corporate paperwork; the §3 design
  measures email-only vs. email+SMS honestly instead of assuming SMS is where the
  delta lives.

**Not measured, listed not guessed:** live delivery rates and opt-out webhook
behavior on any provider (signup-gated); real SMS consent opt-in rate at RSVP
(assumed 60% in §1d); actual campaign-vetting wall-clock for our use case;
Twilio's one-time fee figures verified only via docs ecosystem + two agreeing
aggregators (the canonical support article 403'd); any actual no-show delta
(§3 is a design). **Requires board-approved account creation to measure:**
Twilio/Telnyx sandbox (opt-out + delivery webhooks), SES/ESP account (email
deliverability). **C5 residual for lawyer review:** TCPA consent posture and
state quiet-hour statutes (§1e).

---

*Throwaway artifacts (core.js, core.test.js, test output): session scratchpad
only, per spike rules. Sources fetched 2026-08-31: twilio.com/sms/pricing/us,
telnyx.com/pricing/messaging, twilio.com docs (a2p-10dlc, toll-free verification
policy/onboarding), support.twilio.com vetting FAQ, FCC April-2025 TCPA order
coverage (Nixon Peabody, BCLP, TermsFeed), sociocs.com and ghlscaleup.com fee
breakdowns (aggregators, agreeing). Nothing in this spike touched Lattice, per
the rubric's strategy-work carve-out.*
