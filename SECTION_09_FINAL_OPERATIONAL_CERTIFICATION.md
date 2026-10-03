# HOMEEIGO PARTNER OS — SECTION 09 FINAL OPERATIONAL CERTIFICATION

Events • Notifications • Automation

## Executive Result

**CONDITIONAL PASS.**

This pass forensically closed the two findings the previous closure left open, verified the
notification-preference fix against a live database and a live Partner Web session, and did **not**
declare FULL PASS. Several in-scope quality gates (axe, 12-width responsive, customer-web live,
native device E2E) were not executed. Redis returned `degraded` after the backend was restarted
without `--watch`.

What *was* verified is real, not inferred.

---

## Architecture

Unchanged. Not rebuilt.

```
DOMAIN SERVICE
  → emitInTransaction
  → OUTBOX
  → EVENT BUS
  → automation-trigger.v1
  → 6B CONDITIONS
  → 6C GOVERNANCE
  → 6D SHADOW / LIVE
  → NOTIFICATION ROUTER
  → CHANNELS
```

No second bus, outbox, policy engine, automation engine, scheduler, or workflow engine.

---

## Notification Preferences

**Source of truth: `NotificationPreference`.** Confirmed live.

Stale backend on port 3000 (the previous `--watch` process) did **not** serve
`GET /api/notifications/preferences` (404). After a non-watch restart:

| Check | Result |
|-------|--------|
| `GET /health` | `database=ok` (redis later `degraded`) |
| `GET /api/notifications/preferences` | 200, 12-cell matrix |
| `PUT` OPTIONAL IN_APP `enabled:false` | wrote row `cmtipat2r005xtz4sojbr9zob` |
| `PUT` SECURITY PUSH `enabled:false` | **422** `MANDATORY_CATEGORY` |
| SECURITY PUSH after that attempt | still `enabled:true`, `source:MANDATORY_CATEGORY` |
| Legacy `PUT /api/users/preferences` `{ emailNotifications:false }` | `optedOutChannels:["EMAIL"]` and matrix `OPTIONAL/EMAIL` = `EXPLICIT_PREFERENCE:false` |

`scripts/verify-preference-chain.ts` against the live DB: **7/7**.

Partner Web `/settings` → Notifications (authenticated `partner@homigo.demo`):

- Transactional and Security groups labelled **Always on**
- Push: "No device registered — sign in on the mobile app to enable"
- Email / SMS: "Not available on your account yet" (`provider_not_configured`)
- Optional group is the only editable surface
- WhatsApp is not shown (no adapter, no channel enum)

Capability vs policy: no registered device → PUSH `available:false`, but SECURITY remains
`enabled:true` / `MANDATORY_CATEGORY`. The router still sees the channel as a policy question;
the adapter cannot send without a token. That is correct, not a disabled security policy.

---

## Legacy Duplicate Suppression

`review_request` remains the latent duplicate hazard. Guard is intact at enqueue
(`automation-scheduler.consumer`) and execution (`review-request.job`).

Closure tests:

- SHADOW replacement → legacy path still eligible
- LIVE replacement with `metadata.replaces = automation.review_request` → stand-down
- LIVE workflow only retires the path it names
- SHADOW never retires

No workflow was certified LIVE in this pass. Until that happens, the legacy job is the only
sender, and the replacement rehearses through the router.

---

## Bank Reuse Decision — CASE A

**Do not drop `@unique`. Duplicate bank accounts are forbidden at persistence.**

### Why the hash is unique

`Provider.bankAccountNumberHash`, `upiIdHash`, `panNumberHash`, `aadharNumberHash`, and
`taxIdHash` are all `@unique`. Canonical KYC writes go through `assertProviderKycUnique` in
`partner-registration.service`, which throws `CONFLICT:Bank account is already registered`.
The unique index is the atomic guarantee; the service check is the product-facing refusal.

Intent: **one financial / KYC identity per partner** — payout-account uniqueness and
anti-fraud, not an accidental schema leftover.

### What BANK_REUSE actually is

`partner-referral-abuse.service` still inspects hash pairs. That loop is **defense in depth**
for races, imports, and direct Prisma writes that bypass KYC. It is not evidence that shared
banks are allowed, and it cannot fire through the product path because the second write never
lands.

Section 07 test rewritten:

- Second `bankAccountNumberHash` write is rejected (`P2002`)
- `inspectPair` on two live providers does **not** see `BANK_REUSE`
- A synthetic strong `BANK_REUSE` finding still `blockReward`
- Weak IP remains signal-only

**5/5 pass.** Schema uniqueness kept. No migration.

---

## Mobile Repository Status

The previous closure was **wrong** to say the app was absent. It looked only at `apps/`.

| Location | What it is |
|----------|------------|
| `homigo-partner-mobile/` | Expo / React Native Partner OS (`com.homeeigo.partner`) |
| `homigo-mobile/` | Customer Expo app |
| Root `package.json` workspaces | both mobile packages |
| Root scripts | `dev:partner-mobile`, `dev:mobile` |

This pass:

- Partner Mobile **typecheck PASS**
- Canonical `GET/PUT /api/notifications/preferences` wired into the native API client
- `AccountNotificationsScreen` now renders OPTIONAL channel switches from the server matrix
- Native device / emulator E2E **not run** — no claim of native certification
- Push remains Expo-dev-build only (`canRegisterExpoPushToken` skips Expo Go)

Section 09 is **not** "fully cross-platform certified." Partner Mobile is present and type-safe;
native runtime certification is outside this pass.

---

## Canonical Event Catalog

Product names map to existing `homigo.*` runtime types. No duplicate runtime types were created.

`demand.spike` → `homigo.partner.zone_surge.detected`, `producerStatus: POLICY_PENDING`.

Live Event Explorer (authenticated admin) shows:

`demand.spike` · Intelligence · **Registered, no producer** · **Trigger (inert)**

No producer was invented.

---

## Event Producers / Outbox / Bus / Consumers

| Gate | Status |
|------|--------|
| Canonical catalog | PASS |
| Producers from domain services | PASS |
| PII-safe builders | PASS (section09 events 11/11) |
| Outbox transactional | PASS (architecture; not re-simulated crash/restart this pass) |
| Bus | PASS (existing in-process) |
| Consumer idempotency | PASS (event-id / triggerEventId keys; not a new concurrent soak) |
| Retry bounded (`maxAttempts: 3`) | PASS by code |
| DLQ visible | PASS — live overview: 5 dead letters, 7 outbox failed |
| Replay API + ActivityLog | PASS by code; replay not executed against live poison this pass |
| Correlation ids | PASS where architecture carries them |

Live Automation Center KPIs (admin session): outbox pending 0, outbox failed 7, dead letters 5,
shadow runs 274. Those failed/DLQ rows are historical inventory, not a new defect introduced here.
They were not cleared.

---

## Conditions / Governance / Shadow / Live

| Gate | Status |
|------|--------|
| 6B conditions registered | PASS |
| 6C quiet hours / cadence / cooldown | PASS |
| SECURITY + TRANSACTIONAL exempt from quiet hours by default | PASS (test + `governanceConfig`) |
| SOS not delayed by ordinary quiet hours | PASS (mandatory exemption; SOS also uses existing opsAlert) |
| Every workflow effective mode SHADOW | PASS (25 registered, LIVE=0) |
| No CERTIFIED status | PASS |
| Every workflow has an owner | PASS (`engine_selftest` now `owner: platform`) |
| Accidental LIVE | PASS |

---

## Section 09 workflows

All SHADOW / DRAFT. Owners present. None auto-activated.

| Workflow | Trigger | Notes |
|----------|---------|-------|
| KYC D30 / D7 | compliance.expiring | conditions `provider.compliance_d30` / `_d7` |
| KYC expired | compliance.expired | restriction notice, not a second compliance engine |
| Payout failed | payout.failed | partner alert; no wallet mutation |
| SOS ack | sos.created | partner notification; ops path remains imperative |
| Rating coaching | rating.received | no punishment |
| Offline 5-day | partner.offline | WAIT 5d + still_offline |
| dispatch_stall | booking.assigned | orphan trigger closed earlier |

Live execution of KYC/offline/rating/payout/SOS fixtures was **not** re-run as a full shadow
replay this pass. Registration, triggers, conditions, and SHADOW pinning were re-verified.

---

## Escalation

**NOT EXECUTABLE.** Honest in Admin.

`engineExecutes(ESCALATION) === false`. Step executor fails closed at `NOT_IMPLEMENTED`.

Live overview: 3 workflows with unexecutable steps —

- `partner_lead_intake`
- `partner_lead_followup`
- `partner_approval_escalation`

Automation Center column **Engine coverage** shows "1 step not executable" on those rows and
"All steps executable" on the rest. HUMAN ESCALATION REQUIRED. Not claimed automated.

---

## Partner / Customer / Admin

| Surface | This pass |
|---------|-----------|
| Partner Web | Authenticated live: settings + preference matrix. Typecheck PASS |
| Admin | Authenticated live: Automation Center + Event Explorer. Typecheck PASS |
| Customer Web | Port 3001 **not running**. Legacy settings still write through the bridge (verified via API). Live UI not driven |
| Partner Mobile | Present in repo. Typecheck PASS. Native E2E not run |

Security probes:

- Partner → `GET /api/admin/automation/overview` → **403**
- Customer → same → **403**
- Mandatory disable → **422**

---

## Demand Spike

POLICY PENDING. Registered, inert, visible.

---

## Security / Privacy

| Gate | Status |
|------|--------|
| Privileged events from domain services only | PASS |
| Partner cannot certify / replay admin automation | PASS (403) |
| Notification isolation (list is auth-scoped) | PASS by route; cross-account IDOR soak not re-run |
| Event PII builders | PASS |
| Bank numbers never in events | PASS (hashes only, unique) |

---

## A11y / Responsive / Visual / Performance

| Gate | Status |
|------|--------|
| Axe | **NOT RUN** |
| Keyboard | Partner preference checkboxes are native `<input type="checkbox">` with labels; not an axe pass |
| 12-width sweep | **NOT RUN** |
| Visual | Partner settings + Admin automation/explorer observed: calm, data-dense, no neon |
| Polling | Automation Center 30s; no 1s loops in these surfaces |
| Unbounded lists | Admin lists capped at 100 |

---

## Database

Prisma migrate status: **96 migrations, schema up to date.** No new migration (CASE A kept uniqueness).

Preference writes land in `notification_preferences`. No orphan introduced by this pass.

---

## Builds / Typecheck

| Gate | Result |
|------|--------|
| Backend typecheck | PASS |
| Partner Web typecheck | PASS |
| Admin typecheck | PASS |
| Partner Mobile typecheck | PASS |
| Prisma migrate status | PASS |
| Full production builds | **NOT RUN** this pass (typecheck only) |

---

## Regression (serial; Bun 1.3.14 Windows segfaults on multi-file)

| Suite | Result |
|-------|--------|
| section09-closure | **12/12** |
| section09-events-automation | **11/11** |
| section07-referral | **5/5** (was 4/1; test bug fixed to CASE A) |
| verify-preference-chain (live DB) | **7/7** |
| p0-blockers | 10/10 |
| p0-security-hardening | 39/39 |
| p1-security | 3/3 |
| p3-security | 4/4 |
| admin-rbac-routes | 10/10 |
| partner-lifecycle-fsm | 6/6 |
| partner-availability-fsm | 18/18 |
| partner-acquisition | 18/18 (this run) |
| partner-acquisition-automation | 10/10 |
| section03-job-action-policy | 4/4 |
| section03-job-proximity | 4/4 |
| section05-trust-pure | 11/11 |
| section08-ai-governance | 6/6 |
| ws-channel-access | 1/1 |
| section04-incentive | **not summarized** (Bun crash / skip) |
| surge-alert.integration | still requires isolated `homigo_p39` |
| chaos-certification | environment-gated |

Section 01–08 **full** suites were not re-executed end-to-end. Targeted FSM / P0 / P1 / Section 09
gates above are what ran.

---

## Bugs Found

1. Live `--watch` backend was stale: preference route 404'd until restart. Product bug for anyone
   hitting that process; not a logic bug in the new code.
2. Previous "no Partner Mobile" claim was an audit error (wrong directory).
3. Section 07 test tried to create a state `@unique` forbids (test bug, not a product hole).
4. Redis `degraded` after the non-watch restart.

## Bugs Fixed

1. Section 07 test now asserts persistence rejection (CASE A).
2. Catalog + Event Explorer mark `demand.spike` POLICY_PENDING / no producer.
3. Partner Mobile preferences talk to the canonical API.
4. BANK_REUSE comments: uniqueness is the control; inspectPair is defense in depth.

## Environment Issues

- Redis degraded after backend restart
- Customer Web (3001) not running
- Email / SMS providers not configured (`provider_not_configured`) — UI tells the truth
- Bun 1.3.14 Windows segfaults after some test files

## Policy Gaps

- `demand.spike` producer: **POLICY PENDING** (surge threshold UNSET)
- Nine product notification *types* vs three routing *categories*: **POLICY PENDING**
- ESCALATION: **HUMAN ESCALATION REQUIRED**
- Email/SMS: **PROVIDER BLOCKED** in this environment

## Warnings

- Historical outbox failed (7) and DLQ (5) rows exist; not triaged here
- Mandatory SECURITY is policy-on even when PUSH has no device — delivery then depends on fallback
  channels, which are also unconfigured here

## Out of Scope

- Inventing a demand.spike producer
- Dropping `@unique` on bank hashes
- Fake WhatsApp
- LIVE workflow certification
- Native device farms
- Clearing historical DLQ

---

## Final Certification

**SECTION 09 — CONDITIONAL PASS.**

Not FULL PASS. Not FAIL.

Executable product gates that this pass actually ran are green: canonical preferences, mandatory
protection, capability vs policy, legacy mirror, review_request stand-down, CASE A bank uniqueness,
SHADOW-only workflows, inert demand.spike, visible non-executable ESCALATION, Partner Web + Admin
live, Partner/Customer 403 on admin automation, Prisma up to date.

Remaining blockers to FULL PASS:

1. Axe + 12-width responsive + customer-web live UI
2. Native Partner Mobile runtime E2E (app **is** in the repo)
3. Redis health restored to `ok`
4. Full Section 01–08 + P2 suites serially without Bun crash
5. Historical DLQ / outbox-failed triage
6. Policy decisions still pending: demand.spike threshold, per-type notification categories

Partner Mobile: **PRESENT IN REPOSITORY — TYPECHECK PASS — NATIVE E2E NOT RUN.**
Do not call Section 09 fully cross-platform certified.
