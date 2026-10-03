# HOMEEIGO — SPEAKER NOTES

Technical depth lives here so the slides stay executive. Each note gives you the deeper answer if a
question comes.

---

**SLIDE 01 — Title.** Open with the framing: this is not a booking app with an admin screen bolted
on. Six applications, 189 data models, 173 domain services. If someone asks "how big is it really" —
5,515 lines of database schema and 94 migrations.

**SLIDE 02 — What it is.** The five domains are not marketing groupings; they map to actual code
boundaries with their own services, models, routes and admin pages. If pushed: Acquisition
(`partner-lead.service`), Operations (`partner-operations.service`), Execution (`booking.service`,
`tracking.service`), Finance (`earnings`, ledger, payout, settlement), Trust (risk, safety,
compliance, PII).

**SLIDE 03 — The problem.** Resist the temptation to quantify the market. We have no market data in
the repository. The five friction points are chosen because each has a mechanism later in the deck —
that is the payoff structure of the deck.

**SLIDE 04 — Three experiences.** Every number is measured (`find | wc -l`), not estimated. Note the
admin console is the *largest* surface at 88 pages — that is unusual and worth pointing out: it says
operations were treated as a first-class product.

**SLIDE 05 — Journey.** The three gates are the story. (1) `booking-payment-gate.ts` blocks partner
commitment unless `paymentStatus === SUCCESS`. Its own code comment records why it exists: seven
bookings once reached dispatch unpaid and five completed. (2) Job start requires the customer's OTP.
(3) `booking_completed_requires_timestamp` is a database check constraint — the DB refuses a
completed booking with no completion time. That constraint *rejected a test fixture during this
audit*, which is the control demonstrably working.

**SLIDE 06 — Acquisition.** If asked about KYC, be direct: there is no vendor or government identity
verification. It is document upload to S3 plus admin review. Overclaiming here is the single easiest
way to lose credibility with a technical audience. The 15-state lifecycle is enforced by
`assertLeadTransition`, so illegal transitions are impossible rather than discouraged.

**SLIDE 07 — Matching.** The four filters are real: availability FSM, capacity (`maxJobsPerDay`),
geo (radius/zones/geofence with polygon support and ray-casting), and service eligibility. There is
an integration test asserting exclusion of offline, paused and capacity-full partners. If asked "how
much better is dispatch?" — we do not know, and we do not claim. No measurement exists.

**SLIDE 08 — Execution.** The privacy detail lands well with technical audiences: the partner-facing
contact path selects only `{id, phoneNumber, phoneEncrypted}` — it deliberately does *not* fetch
email. During this audit a type error tempted the opposite fix (adding email to the query); it was
resolved by narrowing the type instead, because fetching PII you do not need is a privacy regression
even when nothing displays it.

**SLIDE 09 — Finance.** The strongest slide for a technical audience. Two points if pressed:
(1) Incentive idempotency is belt-and-braces — a DB unique constraint on
`(providerId, ruleId, periodKey)` *plus* an in-transaction re-check before the credit, i.e.
claim-before-side-effect. (2) We verified consistency on live data read-only: one payout of ₹150,
one wallet transaction of ₹150, one audit row referencing both ids.

Also be ready to own a correction: partner "weekly/monthly projections" previously applied ×1.05 and
×1.08 growth factors with no basis — no comment, no model, no reasoning commit, and applied to
*completed* trailing windows. They are now trailing actuals with an explicit basis block. Owning
that is more persuasive than hiding it.

**SLIDE 10 — Trust.** The retention finding is a good story: `securityEventRetention` used
`includes("HCoin")` — case-sensitive — against event names that are upper-case `HCOIN_*`. Combined
with only debits carrying a keyword, `WALLET_DEBIT` was retained 10 years while the credits funding
it were dropped after 1. Fixed so both halves of a ledger movement retain identically. On SOS: it is
an in-platform incident and alert flow. No emergency-services integration.

**SLIDE 11 — AI/ML.** The line that matters: *the LLM explains, it never decides.* Evidence — surge
is computed in six deterministic services and appears in **no** AI module. On the 14 high-risk tools:
they are catalogued, policy-bound and audited, but **0 of 14 are bound in production** because the
financial sandbox returns `PRODUCTION_ENVIRONMENT`. That is fail-closed by construction.

If asked "is the ML real?" — yes: BigQuery ARIMA_PLUS via `ML.FORECAST`, with confidence *derived*
from the confidence-interval width rather than asserted. Right now it reports 0.5, the clamp floor,
which honestly signals wide intervals on sparse data. And note what we refused to do: the ETA
training dataset was quarantined because its own sheets contradicted the row count and a duration
bound was wrong by 2.2×.

Also worth mentioning as an audit lesson: a grep of the tool catalog reports 41 tools and *zero*
high-risk, because the 14 high-risk entries are generated from a compact `.map()` literal. Only
runtime enumeration is authoritative — an audit that greps would have missed all 14.

**SLIDE 12 — Automation.** The outbox is the key idea: the business write and the event row commit
in one transaction, so an event cannot exist for a rolled-back change, nor be lost for a committed
one. On certification: `certifyAutomation` defaults to SHADOW and requires a real human approver —
its code comment records an incident where a system actor certified nine workflows LIVE with no human
involved. That is why the guard exists.

**SLIDE 13 — Stack.** If asked why no LLM vendor SDK: calls are direct HTTPS, which is exactly what
makes the four-provider failover chain provider-agnostic. Same for Razorpay — direct REST against
`/v1/orders`, `/v1/payments`, `/v1/fund_accounts`, with HMAC webhook verification.

**SLIDE 14 — Security.** The security matrix result is the headline: 9 of 9 attack cases denied with
zero domain mutation. Emphasise the *positive controls* — an engine that denied everything would also
score 9/9, so we proved legitimate operations succeed. Signature verification happens **before**
webhook parsing, which is the correct order.

**SLIDE 15 — Experience.** Use real screenshots only; never any containing PII or secrets.

**SLIDE 16 — Testing.** The isolation discipline is worth a sentence: database tests refuse to run
outside an isolated database, and we proved it by deliberately running one without the override —
it aborted, and production row counts were unchanged. Also mention side-effect sentinels: every
observation compares bookings, payments, wallet, ledger, notifications, outbox and workflow counts
before and after.

**SLIDE 17 — Why this tech.** Keep this slide conversational. The strongest single example is
idempotency: networks retry, and without server-derived idempotency keys a retry becomes a second
refund. We verified 5 concurrent same-key calls produce exactly 1 row.

**SLIDE 18 — Business impact.** If asked for ROI or growth numbers, say plainly that the repository
contains no revenue, GMV, user-count or uptime measurement, so presenting one would be fabrication.
Offer instead to run a measured benchmark. In a technical room this answer earns trust.

**SLIDE 19 — What's next.** The discipline is the message: every capability ships flag-off, is
shadow-observed, then human-approved. Zone recommendations are built and tested but the feature-flag
row was deliberately **not** created, because creating it would enable the capability for real
partners.

A good closing anecdote: the platform's operational zone score is *inverted* for partners — because
service health is 100 when nothing is happening, an idle zone ranked first while a zone with 24
waiting jobs and 2.88× surge ranked last. Reusing the ops score would have sent partners to the
emptiest zones. That is why partner ranking has its own dimensions and carries the platform score
only as evidence.

**SLIDE 20 — Vision.** Land on the three honesty principles: trust is engineered, money is provable,
and intelligence says "I don't know" when it doesn't. The last one is the differentiator — every
signal carries source, freshness and confidence, and missing data becomes an explicit state rather
than a zero.

---

## Questions you should expect

**"Is this production-ready?"** The engineering gates are green: five surfaces typecheck at zero,
security tests pass, money paths are constraint-enforced. Deployment state and live-credential
configuration are environment concerns not verifiable from the repository.

**"How many users / what scale?"** Not measured in the repository. No load-test result exists for the
current build. Do not improvise a number.

**"Is the AI actually used or is it a demo?"** Both, precisely: the gateway, tools, geo-intelligence,
demand forecasting and vision are implemented and reachable. The ETA and fake-GPS models are in
development. The 14 financial/administrative tools are deliberately unbound.

**"What would you fix first?"** Three known items, all recorded: one import cycle in the AI-tools
subsystem; concurrent same-idempotency-key requests returning a raw database error instead of a
structured replay (no integrity impact); and test-isolation drift in a shared test database.
