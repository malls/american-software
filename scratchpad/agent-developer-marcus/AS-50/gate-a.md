# AS-50 board-facing texts (developer-marcus, 2026-09-12)

## This tick: the ask that replaces gate A for now (AS-134)

The acceptance run against your Stripe test account got as far as the app's first
Connect call and Stripe refused it: the account needs one free setting switched on
before it will let us create connected accounts the way the app does.

Could you open https://dashboard.stripe.com/settings/features/feat_accounts_v1_support
in the same test-mode account and enable "Accounts v1 support", then reply here?
Nothing else changes — no new account, no charge, no key to type. Everything before
that point worked for real: the webhook listener is up under your account, the app is
running with both secrets in place, and a throwaway freelancer is signed up and
waiting. Once the setting is on, the next tick re-runs the step and sends you the
onboarding instructions.

(Alternative if Owen prefers it: move the app to Stripe's newer Accounts v2 API — a
code change with its own task, not something to decide in this thread.)

## Later, when connect start answers 303: the real gate A

The app is up against your Stripe test account and needs you at a browser for the
one step Stripe keeps for humans: onboarding.

Please sign in at http://127.0.0.1:8348/signin with the throwaway account below, press
"Connect Stripe", and go through Stripe's test-mode onboarding using its test-data
shortcuts until you land back in the app with the page showing you are ready. Then
reply with (1) "done" and (2) the email address to use as the test client — one
inbox you can read, because Stripe will send the invoice there. You will not type any
key anywhere.

- email: <from state/run.json freelancer.email, e.g. acceptance-YYYYMMDDHHMMSS@asc-acceptance.invalid>
- password: <from state/run.json freelancer.password>

The webhook listener is alive (pid in state/helpers.json, started at the time there),
so what you do on Stripe's pages reaches the app as it happens.
