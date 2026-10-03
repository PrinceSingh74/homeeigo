# HOMEEIGO — EXECUTIVE PRESENTATION
### Slide-ready content · 20 slides · every figure verified against the repository

**Visual direction:** bright premium background (#FFFFFF → #F0FDF4 subtle mint), graphite typography
(#1A1D1A), restrained emerald accent (#3D6B4F), subtle glass panels, generous whitespace, large type,
precise diagrams. No logo walls, no gradients-for-decoration, no stock photography.

---

## SLIDE 01 — TITLE

**HOMEEIGO**
*The Operating System for Trusted Home Services*

**Key message:** Not an app — an operating system spanning customer, partner and operations.

**Content blocks**
- Six applications · one platform
- 189 data models · 173 domain services
- Customer · Partner · Operations

**Visual:** full-bleed mint-to-white gradient, oversized wordmark, one thin emerald rule.

---

## SLIDE 02 — WHAT HOMEEIGO IS

**One platform. Three audiences. Five operating domains.**

**Key message:** Everything a home-services marketplace needs to run, in one coherent system.

**Content blocks**
- **Customer** — discover, book, pay, track, rate
- **Partner** — onboard, work, earn, withdraw
- **Operations** — acquire, dispatch, reconcile, protect
- **Five domains:** Acquisition · Operations · Execution · Finance · Trust & Safety

**Visual:** three columns feeding one horizontal five-domain bar.

**Benefit:** one system of record instead of stitched-together tools.

---

## SLIDE 03 — THE PROBLEM

**Home services fail on trust, not on demand.**

**Key message:** The hard problems are operational, not the booking form.

**Content blocks**
- Can this professional be trusted in my home?
- Will they actually arrive, and when?
- Was the work really done?
- Did the partner get paid correctly?
- Who intervenes when something goes wrong?

**Visual:** five friction points along a journey line, each with an emerald resolution marker.

**Speaker anchor:** every one of these has a concrete mechanism later in the deck.

---

## SLIDE 04 — ONE PLATFORM, THREE EXPERIENCES

| Surface | Technology | Scale (measured) |
|---|---|---|
| Customer web | Next.js 15 · React 19 | 28 pages · 237 components |
| Customer mobile | Expo 54 · RN 0.81 | 29 screens · 130 components |
| Partner web | Next.js 15 | 52 pages · 83 components |
| Partner mobile | Expo 54 · RN 0.81 | 13 screens · 31 components |
| Admin console | Next.js 15 | 88 pages · 80 components |
| Backend | Bun · Elysia | 587 files · 42 routes · 173 services |

**Key message:** Every audience has a purpose-built surface over one shared backend.

**Visual:** five device frames converging on a single API layer.

---

## SLIDE 05 — END-TO-END SERVICE JOURNEY

**Key message:** One continuous chain — no manual handoff between systems.

```
Discovery → Booking → Payment → Matching → Assignment → Execution
   → Evidence → Completion → Earning → Ledger → Wallet
   → Withdrawal → Payout → Settlement → Rating
```

**Content blocks**
- **Payment gate** — a partner is never dispatched to unpaid work
- **OTP-gated start** — the job cannot begin without the customer's code
- **Database-enforced completion** — a completed job must carry a completion timestamp
- **Earning → ledger → wallet** — money is recorded, not merely displayed

**Visual:** horizontal chain, emerald lock icons at the three gates.

---

## SLIDE 06 — PARTNER ACQUISITION & ONBOARDING

**From lead to activated professional, in one funnel.**

**Content blocks**
- **10 attributed sources** — APNA, JOBHAI, referral, RWA, contractor, local shop, direct, social, campaign, partner-referral
- **15-state lifecycle** — NEW → … → APPROVED → ACTIVATED, with duplicate-merge
- **14 onboarding steps** — account → OTP → services → profile → skills → location → availability → KYC → documents → background → assessment → training → review → submit
- **Spend attribution** — campaign cost tracked against source

**Technology:** explicit state machine · document store on S3 · automated reminder workflows.

**Business benefit:** acquisition is attributable and the funnel is one place, not spreadsheets.
**Partner benefit:** always knows which step is blocking activation.

> **Stated honestly:** identity verification is document upload plus admin review. There is no
> third-party or government KYC vendor integration.

---

## SLIDE 07 — PARTNER OPERATIONS & INTELLIGENT MATCHING

**Dispatch that respects reality.**

**Content blocks**
- **Availability state machine** — online / offline / paused, with working hours and breaks
- **Capacity awareness** — max jobs per day, current load
- **Geo eligibility** — service radius, preferred zones, circle **and polygon** geofences
- **Service eligibility** — partner must actually offer the service

**Verified behaviour:** matching **excludes** offline, paused and capacity-full partners — asserted
by integration test, not assumed.

**Visual:** four filters narrowing a candidate pool into a ranked shortlist.

**Benefit:** fewer bad assignments and less manual dispatch intervention.
*No efficiency percentage is claimed — none is measured.*

---

## SLIDE 08 — JOB EXECUTION & FIELD INTELLIGENCE

**Every job is verifiable.**

**Content blocks**
- **Live tracking** — GPS with 10 m / 5 s throttling; a partner counts as present for 60 s after a ping
- **OTP-gated start** — the customer's code opens the job
- **Explicit lifecycle** — PENDING → ACCEPTED → ASSIGNED → EN_ROUTE → IN_PROGRESS → COMPLETED
- **Privacy-first contact** — masked numbers both directions (`+91 •••• 4821`); the raw number appears only in a controlled dial
- **Audited calls** — every controlled call logged with the **masked** number

**Technology:** WebSockets (6 handlers) · Google Maps · Kalman-filtered GPS · S3 evidence.

**Trust benefit:** neither party ever holds the other's phone number, and disputes have evidence.

---

## SLIDE 09 — FINANCIAL OPERATING SYSTEM

**Money is recorded, reconciled and provable.**

```
COMPLETED → Earning (gross · commission · net) → Ledger Entry
        → Wallet → Withdrawal → Payout Batch → Settlement → Reconciliation
```

**Content blocks**
- **Double-entry ledger** — accounts, entries, balance snapshots, backfill runs
- **Reconciliation surfaces** — payout reconciliation, settlement discrepancies, integrity checks
- **Idempotent incentives** — unique `(provider, rule, period)` **plus** an in-transaction re-check
- **Verified live:** an incentive payout of ₹150 matched exactly one wallet transaction of ₹150, with an audit row referencing both

**Why it matters:** duplicate credits are prevented **structurally**, and every rupee is traceable
from job to payout.

**Visual:** vertical money chain with an audit spine alongside.

---

## SLIDE 10 — TRUST, COMPLIANCE, PRIVACY & SAFETY

**Content blocks**
- **PII encryption at rest** — field-level, with key versioning and per-record encryption status
- **Data minimisation** — the partner-facing contact path fetches only the phone pair, never email
- **Risk intelligence** — partner risk profiles and signals, fraud scores, financial risk events
- **Safety incidents & SOS** — in-platform incident flow with ops alerting
- **Retention by category** — financial records 10 years, login events 2 years, system logs 1 year

**Verified during audit:** financial audit events were being retained for 1 year instead of 10
because of a case-sensitive match; corrected so credits are retained exactly like the debits that
fund them.

> **Stated honestly:** SOS is an in-platform incident and alerting flow. There is no integration
> with emergency services.

---

## SLIDE 11 — AI / ML INTELLIGENCE LAYER

**The LLM explains. It never decides.**

```
SIGNALS → DETERMINISTIC / ML DECISIONS → EXPLANATION → ACTION
```

**Content blocks**
- **AI Gateway** — 4 providers (Groq · Gemini · OpenAI · Anthropic) with ordered failover, prompt-injection screening, output validation, per-call cost accounting
- **55 governed tools** — 29 read · 12 write · **14 high-risk, 0 bound in production**
- **Real ML** — BigQuery `ML.FORECAST` ARIMA_PLUS demand model, with a *derived* confidence interval
- **Geo-Intelligence** — 8 endpoints, each carrying confidence, freshness and source
- **Vision** — Gemini image diagnosis via Vertex AI

**Status discipline:** IMPLEMENTED — gateway, tools, demand forecast, geo-intel, vision, partner
context, zone recommendations. IN DEVELOPMENT — ETA model, fake-GPS model, earnings coach.
ROADMAP — shift planning, nudges, morning briefing, copilot.

**Critical guarantee:** surge appears in **no** AI module. Pricing is deterministic.

---

## SLIDE 12 — AUTOMATION & EVENT-DRIVEN OPERATIONS

```
EVENT → CONDITION → GOVERNANCE → ACTION
```

**Content blocks**
- **Transactional outbox** — business change and its event commit together, or neither
- **8 consumers + dead-letter queue** — a failed notification never fails a booking
- **14 workflows** — lead intake, follow-up, onboarding nudge, KYC reminder, training reminder, approval escalation, welcome, payment recovery, checkout recovery, review request
- **18 leader-locked scheduled jobs** — safe on any number of instances
- **Notification governance** — quiet hours → preferences → cadence → cooldown → channel policy → audit

**Certification is hardened:** workflows default to **SHADOW** and require a real human approver.

**What it replaces:** manual lead chasing, manual reminders, manual escalation, manual recovery
outreach. *No hours-saved figure is claimed.*

---

## SLIDE 13 — TECHNOLOGY ARCHITECTURE

| Layer | Technology |
|---|---|
| **Experience** | Next.js 15 · React 19 · Expo 54 · React Native 0.81 · Tailwind · TanStack Query · Zustand |
| **Backend** | Bun 1.3 · Elysia · TypeScript strict · Zod |
| **Data** | PostgreSQL 16 · Prisma 6 · Redis · AWS S3 · BigQuery |
| **Real-time** | WebSockets (6) · transactional outbox · event bus · DLQ |
| **Intelligence** | Groq · Gemini · OpenAI · Anthropic · Vertex AI · BigQuery ML |
| **Automation** | 14 workflows · 18 scheduled jobs · notification governance |
| **Security** | JWT · RBAC · OTP · rate limiting · field-level PII encryption · audit |
| **Payments** | Razorpay (orders · payments · payouts · webhooks) |
| **Comms** | Twilio · Resend · Expo Push · in-app |
| **Observability** | Prometheus · Sentry · structured logging |

**Visual:** ten horizontal bands, emerald left rule, no vendor logos.

---

## SLIDE 14 — SECURITY & DATA ARCHITECTURE

```
IDENTITY → AUTHORIZATION → DATA ACCESS → PRIVACY → AUDIT → RISK
```

**Content blocks**
- **Identity** — JWT with refresh-token rotation and reuse detection; OTP
- **Authorization** — RBAC by resource and action; ownership resolved **server-side**, never from request arguments
- **Data** — field-level PII encryption with key versions; 481 indexes; 29 unique constraints
- **The database enforces truth** — a completed booking must carry a completion time; one customer cannot hold two overlapping bookings
- **Audit** — typed security events with retention categories

**Proven, not asserted:** 9 of 9 attack cases denied — cross-role access, IDOR, actor spoofing,
injected `admin:true` / `allUsers:true`, forged approval — with zero data mutation, and positive
controls confirming the engine is not simply refusing everything.

---

## SLIDE 15 — CUSTOMER / PARTNER / ADMIN EXPERIENCE

**Content blocks**
- **Customer** — home, search, booking, payment, live tracking, controlled call, receipt, review, privacy centre
- **Partner** — onboarding, availability, job requests, navigation, earnings, wallet, withdrawals, incentives, academy, compliance, safety
- **Admin (88 pages)** — command centre, acquisition CRM, verification queue, live operations, finance, reconciliation, fraud, compliance, analytics, AI oversight, digital twin, geospatial

**Key message:** operations get first-class software, not an afterthought admin panel.

**Visual:** three-column screen grid using real screenshots where available (no PII).

---

## SLIDE 16 — TESTING & PRODUCTION ENGINEERING

```
Unit/service (96 files) → Integration (isolated DB) → API + security
  → Web E2E (44 specs) → Mobile E2E (8) → Certification scripts (226) → CI
```

**Content blocks**
- **Typecheck across five surfaces** — backend, customer web, admin, partner web, customer mobile: **0 errors each**
- **Security testing** — RBAC, IDOR, spoofing, injection, concurrency
- **Isolation discipline** — DB tests refuse to run outside an isolated database
- **Side-effect sentinels** — bookings, payments, wallet, ledger, notifications, outbox and workflow counts compared before and after every observation

**Benefit:** release risk is reduced by construction — the gates fail rather than warn.

---

## SLIDE 17 — WHY THIS TECHNOLOGY

| Technology | Why | What it enables | Business benefit |
|---|---|---|---|
| **PostgreSQL + constraints** | Money and job state must be correct | Invalid states rejected by the database | Financial integrity independent of code bugs |
| **Transactional outbox** | Side effects must not be lost | Event and business change commit together | Notifications and automation are trustworthy |
| **Idempotency** | Networks retry | Safe replay | No duplicate payouts or bookings |
| **Redis leader locks** | Multi-instance scheduling | 18 jobs run once, not N times | Safe horizontal scaling |
| **WebSockets** | State changes are pushed | Live tracking and live ops | Faster awareness for both sides |
| **Provider-agnostic LLM chain** | Vendors fail and change | Ordered failover | AI features degrade, not break |
| **Feature flags (fail-closed)** | Safe rollout | Off unless explicitly enabled | New capability cannot leak on by accident |
| **TypeScript strict end-to-end** | Contracts span 6 apps | Compile-time contract errors | Fewer production surprises |

---

## SLIDE 18 — BUSINESS IMPACT

**Key message:** Technical choices map to specific business outcomes.

| Capability | Outcome |
|---|---|
| Attributed acquisition | Spend measured per source and campaign |
| Capacity-aware matching | Fewer impossible assignments |
| Payment-gated dispatch | Partners are not sent to unpaid work |
| Evidence + OTP execution | Disputes have an evidence trail |
| Double-entry ledger | Payouts are reconcilable and auditable |
| Idempotent incentives | Duplicate credits structurally prevented |
| Masked communication | Contact details never exchanged |
| Governed notifications | Fatigue and compliance handled centrally |
| Fail-closed AI governance | No autonomous financial action |

> **Deliberately absent:** revenue, GMV, user counts, uptime and efficiency percentages. None are
> measured in the repository, so none are presented.

---

## SLIDE 19 — WHAT'S NEXT

**Partner Intelligence — foundation shipped, capabilities sequenced**

**Content blocks**
- **Shipped:** canonical partner context (9 signals, versioned rules) and deterministic zone recommendations with per-reason explainability — behind a flag that is **off**
- **In development:** earnings coach grounded in realised net earnings
- **Sequenced:** shift planning · performance nudges · morning briefing · surge alerts · partner copilot
- **Discipline:** each capability ships flag-off, shadow-observed, then human-approved

**Visual:** a roadmap rail with two solid emerald nodes and five outlined ones.

---

## SLIDE 20 — VISION

**HOMEEIGO**
*From marketplace to operating system.*

**Key message:** The platform already runs the full lifecycle. The next layer makes it advisory —
telling partners where the work is and why, with evidence attached to every recommendation.

**Closing blocks**
- Trust is engineered — gates, evidence, masking, audit
- Money is provable — double-entry, reconciled, idempotent
- Intelligence is honest — sources, freshness, confidence, and an explicit "we don't know"

**Visual:** the five-domain bar from slide 02, now complete, with a thin intelligence layer above it.
