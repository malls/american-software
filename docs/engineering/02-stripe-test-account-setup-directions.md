# Stripe test-mode account setup — explicit directions for the board (AS-51)

**Status:** open board ask. AS-51 stays `needs_human` until the board has run
these steps. Requested by the board in DM (conv 7, msg 387, 2026-09-01): "explicit
directions for AS-51."
**Author:** Owen Kessler, CTO. **Date:** 2026-09-01.
**Scope guard:** engineering opens nothing. Every step below is performed by the
board member, personally, on an account that is his. This document is the
instruction set, not an action.

**Honesty note on menu paths:** this was written without web access (headless
ticks have WebFetch/WebSearch denied — AS-55), so every Stripe *dashboard
wording or menu location* below is from knowledge that may lag the current UI.
Steps where the label may have moved are marked **[UI may differ]**. The API
facts (key prefixes, account defaults, CLI behavior) are stable and are what the
build actually depends on. Where a label doesn't match, trust the *goal* stated
in the step, not the label.

---

## 0. What "done" looks like

At the end you will have: one Stripe account in test mode, never activated;
Connect enabled on it; the Stripe CLI installed and authenticated on this
machine; and one test-mode secret key written into a gitignored file. You hand
over zero secrets through chat, Lattice, or email.

## 1. Create the account

1. Go to `https://dashboard.stripe.com/register`. Sign up with an email you
   control (it's your account — `_@forrestalmasi.com` or whatever you prefer),
   set a password, verify the email.
2. Skip every prompt that offers to "activate", "start accepting payments", or
   collect business details. You will be nagged; decline. A Stripe account is
   fully usable for our purpose without ever completing activation.
3. **Confirm you are in test mode.** The dashboard shows a test-mode indicator —
   historically a "Test mode" toggle in the top bar (orange when on); newer
   accounts may instead present this as a **Sandbox** (Stripe rebranded
   test-mode workspaces around 2024–2025) **[UI may differ]**. Either
   presentation is fine for us. The ground truth is the API keys: everything you
   copy later must start with `sk_test_` / `pk_test_`. If you ever see
   `sk_live_`, you are in the wrong mode — stop and flip back.
4. Do **not** add a bank account, business address, EIN, or any verification
   detail. Test mode asks for none of it; if a screen asks, you've wandered into
   activation — back out.

## 2. Enable Connect

1. In the dashboard, find **Connect** — historically in the left navigation or
   via the top search bar; "Connect" → "Get started" / "Overview"
   **[UI may differ]**.
2. Stripe may ask platform-profile questions (what kind of platform, who your
   users are). Answering in test mode is free and commits you to nothing;
   answer truthfully as "a platform where service providers (freelancers)
   collect payments from their clients on their own Stripe accounts."
   **[UI may differ — it is possible test mode lets you defer this
   questionnaire entirely; if it does, defer it.]**
3. **What the build assumes** (pinned in AS-41 and verified in the D1 spike,
   `docs/strategy/spikes/spike-D1-freelancer-invoicing.md` §1): connected
   accounts are created with a bare `POST /v1/accounts` — no `type` parameter —
   which yields the **Standard-equivalent controller defaults**:
   `losses.payments=stripe`, `fees.payer=account`,
   `requirement_collection=stripe`, `stripe_dashboard.type=full`. In dashboard
   terms: freelancers get their own full Stripe dashboard, Stripe collects
   their KYC, Stripe bears payment-loss liability, and the freelancer pays
   Stripe's fees. If the Connect setup flow asks you to choose a default
   "account type" or liability configuration, pick the option matching that —
   full-dashboard accounts, Stripe collects requirements, your platform not
   liable for losses **[UI may differ — the flow may not ask at all, since the
   defaults are set per API call; if unsure, choose nothing and tell me what it
   asked]**.
4. Nothing else. No branding, no payout settings, no OAuth setup.

## 3. Install and authenticate the Stripe CLI (on this machine)

1. `brew install stripe/stripe-cli/stripe` (this Mac has Homebrew).
2. `stripe login` — it prints a pairing code and opens the browser; confirm the
   code against the dashboard session for the new account. This stores a
   CLI credential in `~/.config/stripe/config.toml` — in your home directory,
   outside the repo, which is exactly where we want it.
3. Verify: `stripe config --list` shows the account; the display name should
   match the new account and the default should be test mode.
4. What it's for: `stripe listen --forward-to localhost:8348/...` forwards real
   test-mode webhook events (`invoice.*`, `account.updated`, etc.) from Stripe
   to the local docker-compose stack. This is one of the three things
   stripe-mock provably cannot simulate (webhook delivery/ordering/signatures)
   and is required by AS-50, the recorded acceptance run that *is* v1's
   definition of done. The exact forward path will be pinned when AS-42 (webhook
   task) lands — you don't run `listen` today; authenticating the CLI is enough.
   The webhook signing secret (`whsec_…`) is minted locally by
   `stripe listen --print-secret` at run time, so it is *not* part of your
   handover.

## 4. Credentials to hand over — and the only acceptable channel

We need exactly **one secret**: the **test-mode secret key** (`sk_test_…`), from
the dashboard's API-keys page (historically Developers → API keys; newer UIs
put this under "Workbench" or the sandbox settings **[UI may differ]**). Reveal
the "Secret key" for **test mode** and copy it.

Also useful, neither secret: the **publishable key** (`pk_test_…`) and the
**account ID** (`acct_…`, from account settings). Those two may travel in the DM.

**The secret key must never appear in:** a chat message, a Lattice comment, an
email, or any committed file. Chat and Lattice are durable, exported, and read
by every agent; a key pasted there is burned and would have to be rolled.

**Where it goes instead — create this file yourself:**

```
# file: apps/invoicing/.env.local   (create it; it does not exist yet)
STRIPE_SECRET_KEY=sk_test_...your key...
```

That path is **gitignored as of this commit** — I added
`apps/invoicing/.env.local` (and `*.env.local`) to `.gitignore` in the same
change that added this document, so git cannot pick it up even by accident.
Verify yourself if you like: `git check-ignore -v apps/invoicing/.env.local`.

**What the repo does today vs. what will exist:** today nothing reads that file
— AS-37's config loader has the `secret`/`required` machinery built and tested
but deliberately declares no credential (no account existed). AS-38 (the Stripe
client wrapper) adds the `STRIPE_SECRET_KEY` schema row (`secret: true`, so it
is redacted from every log line by the existing mechanism) and points the
compose file at `.env.local` via `env_file`. Until AS-38 lands the file simply
sits there, ignored by git, waiting.

**Then tell me in the DM** (no key material): "account created, Connect
enabled, CLI authenticated, key is in the file" — plus the `acct_…` id and
`pk_test_…` if you're willing. That message is what flips AS-51 out of
`needs_human`.

## 5. What we do with it, and what you should expect to see

- AS-38 wires the key into the custody-guard Stripe wrapper (every API call
  goes through it; never in the flow of funds stays a design constraint).
- AS-41 exercises Connect onboarding: the app will create test connected
  accounts and hosted onboarding links against your account.
- AS-50, the acceptance run: a scripted freelancer signs up, connects a test
  Stripe account, sends a test invoice, and "pays" it with Stripe's test card
  (4242 4242 4242 4242). Afterward your dashboard's test view will show a
  handful of connected test accounts, test customers, and test invoices. That
  clutter is expected and deletable; no real money can move.
- Named residual (AS-41): it is unconfirmed whether Stripe test mode accepts
  `http://localhost` return/refresh URLs for hosted onboarding. If it rejects
  them, the acceptance task files a new board ask for local ingress — nothing
  is opened without you.

## 6. What NOT to do

- Do **not** activate the account or complete any business-verification flow.
- Do **not** add a bank account or payout details.
- Do **not** copy anything prefixed `sk_live_` — if live keys are even visible,
  ignore them; we never want them, and at incorporation the account is closed
  or transferred as a separate decision (AS-51 description, "whose account it
  is").
- Do **not** paste `sk_test_…` (or any `whsec_…`) into chat, Lattice, email, or
  any file other than `apps/invoicing/.env.local`.
- Do **not** create restricted keys, OAuth apps, or extra team members — not
  needed for v1.
