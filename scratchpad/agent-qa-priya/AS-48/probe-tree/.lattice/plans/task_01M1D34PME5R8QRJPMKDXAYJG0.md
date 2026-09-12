# AS-52: Board ask: confirm v1's definition of done before the build executes against it

BOARD ASK. Answerable yes or no with no follow-up question needed. Full text below; it is also recorded in docs/engineering/00-d1-v1-milestone-plan.md section 7.1 (ask A2).

WHAT WE ARE ASKING FOR
Your confirmation of what "v1 done" means, before fifteen build tasks are executed against it.

THE DEFINITION WE HAVE SCOPED TO
v1 is done when the loop closes end to end IN STRIPE TEST MODE ON A LOCAL DOCKER-COMPOSE STACK: a freelancer signs up, connects their own Stripe account, generates a contract for a client, issues an invoice on that client on their own account, the client pays, and the freelancer sees it paid — verified by an automated suite plus one recorded manual run.

WHAT v1 EXPLICITLY DOES NOT INCLUDE
No production deployment and no publicly reachable URL. No domain or DNS. No live money and no real customer. No marketing or public pages. No email sent by us at all — invoice mail rides Stripe's own sender infrastructure. And the contract body is clearly-marked placeholder text until the lawyer-agent review of the adapted Common Paper templates clears.

WHY WE ARE ASKING RATHER THAN ASSUMING
Three of those exclusions are not engineering preferences — they are gated on decisions the engineering org does not own. Deployment needs a Digital Ocean project and a domain; the domain needs the product name, which is a separate exercise (docs/strategy/09-company-name.md section 8.2); live money needs an incorporated entity and a live-mode processor account (docs/strategy/08-board-decision.md section 3.3). Scoping v1 around them is what keeps the build off a critical path we cannot control. But if your expectation of "v1" is a deployed, publicly reachable product with real users, the milestone plan changes materially and several gated items move into the critical path — and it is far cheaper to hear that now than at the acceptance run.

COST
$0. This is a confirmation, not a purchase and not a signup.

WHAT HAPPENS IF YOU CORRECT US
We re-scope the milestone plan, record it in its amendment log, and file the deployment, domain, and naming asks immediately. No work is wasted: everything in the current plan is needed under either definition; the question is only what else joins it and in what order.

ANSWER SHAPE
"Yes, that is v1" — or "no, I expect X".
