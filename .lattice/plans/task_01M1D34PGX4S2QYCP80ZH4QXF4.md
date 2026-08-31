# AS-51: Board ask: free Stripe test-mode account with Connect, for v1 acceptance

BOARD ASK. Answerable yes or no with no follow-up question needed. Full text below; it is also recorded in docs/engineering/00-d1-v1-milestone-plan.md section 7.1 (ask A1).

WHAT WE ARE ASKING FOR
That you create one free Stripe account, leave it in TEST MODE, and enable Connect on it — and that we may use the Stripe CLI's local webhook forwarding (stripe listen) under that same account. One signup, no second vendor.

COST
$0. A Stripe test-mode account requires no card, no activation, no bank details, and no business verification. The Stripe CLI is a free first-party tool that authenticates against this same account; it needs no separate service. No purchase is involved, but the standing rule is that every processor, ESP, or carrier signup is board-gated regardless of price (CLAUDE.md, Product), so this is a board decision either way.

WHOSE ACCOUNT IT IS
Yours, personally — the company is unincorporated and has no legal person able to hold an account. Test mode only; never activated for live payments. At incorporation the account is either closed or transferred to the entity, and we bring that back to you as a separate decision rather than assuming it now.

WHAT IT UNBLOCKS
The recorded acceptance run that IS v1's definition of done, plus honest verification of the three things stripe-mock provably cannot simulate: webhook delivery, ordering and signatures; the hosted Connect onboarding round trip and its return/refresh URLs; and Stripe's own invoice email plus the hosted payment page. Nothing else in v1 blocks on it — the other fourteen build tasks are all verifiable without any account, by design.

WHAT HAPPENS IF YOU SAY NO
v1 still builds, and its automated suite still passes — but against a Stripe double we wrote ourselves. We would be shipping a payments integration that has never once been exercised against the real API, and the acceptance run stays blocked, so v1 could not honestly be declared done. We would record that and continue; we would not work around it by opening anything.

ALTERNATIVES CONSIDERED
stripe-mock (already used in the spike; free, no account) validates request and response shapes against Stripe's own OpenAPI spec, but it is stateless and emits no webhooks. A hand-written stateful fake — we are building one anyway for the automated suite — tests our logic against our own assumptions, which is precisely the failure mode a real-API run is supposed to catch. Neither substitutes for the real thing; both remain in use alongside it.

WHAT WE HAVE NOT DONE
No account has been opened, and no task in the v1 plan assumes one exists.
