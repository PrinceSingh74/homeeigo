# HOMEEIGO — PRODUCT AUDIT

Forensic audit of the repository. Every claim below is traceable to code, schema, configuration or
tests. Items that could not be confirmed are marked **Not verified in repository**.

---

## 1. What HOMEEIGO is

A **home-services marketplace platform** connecting customers who need home services with vetted
service partners, operated through an admin/operations console.

Evidence: `apps/backend/prisma/schema.prisma` (189 models) defines `User`, `Provider`, `Service`,
`Booking`, `Earning`, `WalletTransaction`, `Rating`; six applications exist for three audiences.

Public brand is "Homeeigo"; internal identifiers, metrics and booking prefixes use `homigo`
(verified across metric names such as `homigo_ai_context_cache_denied_total` and event types such as
`homigo.booking.cancelled`).

## 2. Applications (six, all present)

| Application | Path | Surface measured |
|---|---|---|
| Backend API | `apps/backend` | 587 TypeScript files · 42 route modules · 173 services |
| Customer web | `apps/web` | 28 pages · 237 components |
| Partner web | `apps/partner-web` | 52 pages · 83 components |
| Admin console | `apps/admin-panel` | 88 pages · 80 components |
| Customer mobile | `homigo-mobile` | 29 screens · 130 components |
| Partner mobile | `homigo-partner-mobile` | 13 screens · 31 components |

## 3. Users

Derived from `UserRole` (`CUSTOMER`, `VENDOR`, `ADMIN`) and `AiGatewayRole`
(`CUSTOMER`, `PARTNER`, `ADMIN`, `SUPPORT`, `SYSTEM`, `AUTOMATION`), plus the admin RBAC service.

1. **Customer** — discovers, books, pays, tracks, rates.
2. **Partner / service professional** — onboards, sets availability, accepts jobs, executes, earns.
3. **Admin / Operations** — 88 console pages spanning acquisition, operations, finance, trust.
4. **Finance** — dedicated console area (`/finance/*`: reconciliation, payouts, settlements,
   chargebacks, integrity, unit-economics).
5. **Support** — `SUPPORT` role and support-ticket domain.
6. **Trust & Safety** — risk, compliance, safety-incident domains.

## 4. Core business flow (verified end to end)

```
Discovery → Booking → Payment → Matching → Assignment → Execution
        → Evidence → Completion → Earning → Ledger → Wallet
        → Withdrawal → Payout → Settlement → Rating
```

Evidence per stage:

| Stage | Verified in |
|---|---|
| Discovery | `routes/services.ts`, `catalog.service.ts` |
| Booking | `Booking` model, `booking.service.ts`, `booking-validation.service.ts` |
| Payment | `payment.service.ts`, Razorpay REST, `booking-payment-gate.ts` |
| Matching | `matching.service.ts` (`findBestProviders`, `maxResults = 10`) |
| Assignment | `AssignmentAttempt`, `assignment-engine`, `booking-priority.service.ts` |
| Execution | `BookingStatus` (PENDING→ACCEPTED→ASSIGNED→EN_ROUTE→IN_PROGRESS→COMPLETED) |
| Start gate | `booking-start-otp.service.ts` (OTP-gated job start) |
| Tracking | `tracking.service.ts`, `LocationHistory`, `/ws/tracking/:bookingId` |
| Completion | `booking_completed_requires_timestamp` DB check constraint |
| Earning | `Earning` model with `grossAmount` / `netEarning` / commission |
| Ledger | `LedgerAccount`, `LedgerEntry`, `LedgerBalanceSnapshot` |
| Wallet | `WalletTransaction`, `wallet.service.ts` |
| Withdrawal | `Withdrawal`, `provider-wallet-reservation.service.ts` |
| Payout | `PayoutAttempt`, `PayoutBatch`, `PayoutBatchItem`, `PayoutReconciliation` |
| Settlement | `PaymentSettlement`, `SettlementBatch`, `SettlementDiscrepancy` |
| Rating | `Rating`, `ratings.ts` routes, public recent-reviews feed |

## 5. Section 01 — Partner acquisition & onboarding

**Verified models:** `PartnerLead`, `PartnerLeadActivity`, `AcquisitionSpend`, `ProviderDocument`.
**Verified enums:** `PartnerLeadStatus` (15 members: NEW → CONTACTED → INTERESTED →
APPLICATION_STARTED → APPLICATION_SUBMITTED → KYC_PENDING → VERIFICATION → TRAINING → APPROVED →
ACTIVATED, plus DORMANT/REJECTED/DUPLICATE/INVALID/WITHDRAWN), `PartnerLeadSource` (10: APNA,
JOBHAI, REFERRAL, RWA, CONTRACTOR, LOCAL_SHOP, DIRECT, SOCIAL, CAMPAIGN, PARTNER_REFERRAL),
`PartnerLeadActivityType` (10).

**Verified services:** `partner-lead.service.ts`, `partner-lead-state-machine.ts`,
`partner-lead-merge.ts`, `partner-onboarding.service.ts`, `partner-registration.service.ts`,
`partner-application-invite.ts`, `partner-assessment-bank.ts`, `partner-academy-requirements.ts`,
`partner-activation-checklist.ts`, `partner-acquisition-analytics.service.ts`.

**Verified onboarding steps** (`ONBOARDING_STEPS`): account, otp, services, profile, skills,
location, availability, kyc, documents, background, assessment, training, review, submit.

**Verified admin surface:** `/partner-acquisition` console with 12+ endpoints (leads, transitions,
assignment, activity, merge, applications, verification, approvals, spend).

**What it does:** captures leads with source attribution and campaign spend, runs a 15-state
lifecycle with a merge path for duplicates, drives a 14-step onboarding, and gates activation behind
document, assessment and training checks.

**Business benefit:** attributable acquisition (`AcquisitionSpend` by source/campaign) and a single
funnel rather than scattered spreadsheets.
**Technical benefit:** an explicit state machine (`assertLeadTransition`) makes illegal transitions
impossible rather than merely discouraged.
**User benefit:** a partner sees exactly which step blocks activation.

**Important limitation — Not verified in repository:** there is **no third-party/government KYC
vendor integration**. KYC is document upload plus admin review (`ProviderDocument`). Any claim of
automated government identity verification would be unsupported.

## 6. Section 02 — Partner operations & availability

**Verified:** availability FSM (`partner-availability-fsm.test.ts`), online/offline
(`Provider.isOnline`, `POST /me/online`), pause/resume (`providerPauseSchema`), working hours and
breaks (`partner-ops-clock.ts` with `BreakWindow`), service radius and zones
(`/me/service-area/zones`), capacity (`Provider.maxJobsPerDay`, capacity-aware matching),
`Geofence` model with circle **and** polygon support (`shape`, `polygon`, ray-casting
point-in-polygon), attendance check-in/out.

**Verified matching inputs** (`matching.service.findBestProviders`): eligibility, availability,
capacity, location. Integration test asserts matching **excludes** offline, paused and
capacity-full partners.

**Business benefit:** dispatch respects real operating constraints instead of assuming availability.
**Do not claim** a quantified dispatch-efficiency improvement — no measurement exists in the repo.

## 7. Section 03 — Job execution & field operations

**Verified:** `BookingStatus` lifecycle; assignment attempts with a status-priority dedup migration;
GPS tracking (`Location`, `LocationHistory`, throttled at 10 m / 5 s, `PRESENCE_TTL_SEC = 60`);
OTP-gated job start (`booking-start-otp.service.ts`); arrival/en-route states (ADR-018);
6 WebSocket handlers (tracking, notifications, booking, earnings, admin-ops); controlled calling
with **masked phone numbers** (`booking-contact.service.ts`, `maskPhoneForPartner` →
`+91 •••• 4821`); activity logging of every controlled call with a masked number.

**Payment gate (notable):** `booking-payment-gate.ts` blocks partner commitment unless
`paymentStatus === SUCCESS`, with an explicit audited admin override
(`PAYMENT_GATE_OVERRIDE`). Its own comment records the incident that motivated it: seven bookings
reached dispatch unpaid and five completed.

**Trust benefit:** neither party ever receives the other's raw phone number; the dial happens
through a controlled action and is audited with a masked value.

## 8. Section 04 — Earnings, wallet, finance

**Verified chain:** `COMPLETED booking → Earning (gross, commission, net) → LedgerEntry → WalletTransaction → Withdrawal → PayoutAttempt/PayoutBatch → PaymentSettlement → reconciliation`.

**Verified integrity controls:**
- Double-entry structures: `LedgerAccount`, `LedgerEntry`, `LedgerBalanceSnapshot`,
  `LedgerBackfillRun`, `LedgerBackfillIssue`.
- Reconciliation surfaces: `PayoutReconciliation`, `SettlementDiscrepancy`, `SettlementSyncRun`,
  admin `/finance/integrity` and `/finance/reconciliation` endpoints.
- Idempotency: `idempotency_key` unique constraint on AI tool executions; withdrawal reservations
  (`provider-wallet-reservation.service.ts`); payment reservation reclaim.
- Incentives: `PartnerIncentiveRule` → progress → `PartnerIncentivePayout`, idempotent via
  `@@unique([providerId, ruleId, periodKey])` **plus** an in-transaction re-check before crediting.

**Verified live consistency (read-only query):** one incentive payout of ₹150 matched exactly one
`WalletTransaction` of ₹150 (type BONUS, status COMPLETED), with an audit row referencing both ids.

**Verified during this audit — corrected defects:** weekly/monthly partner "projections" previously
applied unfounded ×1.05 / ×1.08 growth factors; they are now trailing actuals with an explicit
`basis` block. A gross/net unit mismatch in the same calculation was also corrected
(`averageNetPerJob` added).

**Business benefit:** money movements are reconstructable and reconcilable, and duplicate credits are
prevented structurally rather than by convention.

## 9. Section 05 — Trust, compliance, safety, risk

**Verified:** `PartnerRiskProfile`, `PartnerRiskSignal`, `FraudRiskScore`, `FinancialRiskEvent`,
`PartnerSafetyIncident`, `ComplianceRequest` (with `ComplianceRequestStatus`: PENDING/APPROVED/
PROCESSING/COMPLETED/REJECTED/EXPIRED), `partner-safety.service.ts` (SOS handling), data-retention
service with categories (`FINANCIAL_LEDGER` 10 years, `LOGIN_EVENTS` 2 years, `SYSTEM_LOGS` 1 year),
PII encryption via a Prisma extension (`prisma-pii-extension.ts`) with key versioning
(`emailEncryptionKeyVersion`, `phoneEncryptionKeyVersion`, `dataEncryptionStatus`), masking helpers,
and legal/consent surfaces (`routes/legal.ts`, `routes/compliance.ts`).

**Verified during this audit — corrected defect:** financial audit events
(`PARTNER_INCENTIVE_CREDITED`, `REFERRAL_COMMISSION_CREDITED`, `HCOIN_*`,
`FINANCIAL_ADJUSTMENT_EXECUTED`) were being retained for 1 year instead of 10 because of a
case-sensitive substring match; they now classify as `FINANCIAL_LEDGER`.

**Not verified in repository:** emergency-services dispatch (no integration with police/ambulance
providers). SOS is an in-platform incident + alert flow.

## 10. Product surface inventory (pages actually found)

**Customer web (28 pages):** home, services, book, bookings, tracking, wallet, profile, AI assistant,
legal/privacy/terms/cookies, reviews.
**Partner web (52 pages):** login, onboarding, availability, requests, navigation, map, route-center,
earnings, earnings-hq, wallet, invoices, rewards, membership, academy, performance-hq, territory-hq,
work-hq, intelligence, ai, ai-hq (demand-forecast / earnings-coach / route-optimization),
trust-compliance, wellbeing, reviews, support, settings.
**Admin (88 pages):** dashboard, command-center, partner-acquisition, vendors, customers, bookings,
payments, settlements, transfers, invoices, finance, fraud, compliance, coverage, geofences,
geospatial, heatmap, operations, observability, alerts, analytics, ai, ai-brain, digital-twin,
eta-intelligence, vision, weather, workforce, academy, campaigns, loyalty, membership, referrals,
reviews, services, support, gift-cards, chargebacks, account-deletions, settings.
**Customer mobile (29 screens)**, **Partner mobile (13 screens + HQ registry)**.

## 11. Differentiators supported by code

1. **End-to-end partner lifecycle** — lead → onboarding → activation → operations → earnings →
   payout, in one system (Sections 01–05 all present).
2. **Capacity-aware, geo-eligible matching** — availability + capacity + location + service
   eligibility, with a test proving exclusion of offline/paused/full partners.
3. **Payment-gated dispatch** — a partner is not committed to unpaid work; overrides are audited.
4. **Evidence-and-OTP-gated execution** — job start requires an OTP; completion requires a timestamp
   at the database level.
5. **Privacy-first communication** — masked phone numbers on both directions of the controlled call.
6. **Double-entry financial core with reconciliation** — ledger, settlement discrepancy tracking,
   integrity endpoints.
7. **Governed AI tool layer** — 55 tools with policy, approval, audit and a fail-closed high-risk
   freeze (0 of 14 bound in production).
8. **Event-driven side effects** — transactional outbox → event bus → 8 consumers → DLQ.

---

**Audit method note:** counts were produced by direct measurement (`grep -c`, `find | wc -l`,
runtime enumeration) rather than estimation. Live-data checks were read-only against `homigo_db`.
