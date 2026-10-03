# HOMEEIGO — Unwired Capabilities

**Re-measured 2026-09-21 (second pass): 570 consumed / 92 with no automated match, of 662 distinct backend paths.**

This is a **classification** document, not a backlog of screens to generate. Per the operating
principle: wire only where the intended consumer is already objectively established by code or
workflow; where product intent is ambiguous, say so rather than invent a UX.

---

## 1. Measurement honesty first

The automated matcher (`consumption2.ts`) normalises `:param`, `[param]` and `${...}` to a wildcard
and compares segment-by-segment. **It is wrong in both directions, and the count of 92 must not be
read as precise.**

| Failure mode | Example | Effect |
|---|---|---|
| **Over-match** (reports consumed when it is not) | Admin calls `/api/customer-intel/${userId}`, which normalises to `/api/customer-intel/*` and then matches `/api/customer-intel/me`, `/recommendations`, `/rebooking`, `/maintenance` | Hid **5 real orphans** |
| **Under-match** (reports orphan when consumed) | `POST /api/digital-twin/*/scenario` | Flagged as orphan; a targeted grep finds **1 consumer** |

Ground-truth greps on the disputed paths:

```
customer-intel/me               consumers=0      digital-twin/.*scenario   consumers=1
customer-intel/recommendations  consumers=0      digital-twin/.*what-if    consumers=0
customer-intel/rebooking        consumers=0
customer-intel/maintenance      consumers=0
customer-intel/satisfaction     consumers=0
recommendation-click            consumers=0
```

**Treat any single row as a lead; the aggregate is directionally sound and the verified rows below are not.**

### The `Auth` column was a heuristic and it was wrong

An early pass flagged `POST /api/analytics/etl/run`, `POST /api/analytics/features/export`,
`POST /api/ai/gateway/chat`, `/api/ai/customer` and `/api/ai/admin` as `PUBLIC?`. That looked like a
serious exposure. **It was not.** The heuristic read a text window around each handler and missed
router-level `.use(authPlugin)`.

Runtime probes, unauthenticated, settled it:

```
POST /api/analytics/etl/run        -> 401
GET  /api/analytics/quality        -> 401
GET  /api/analytics/freshness      -> 401
POST /api/ai/gateway/chat          -> 401   (with a well-formed body)
POST /api/ai/customer              -> 401   (with a well-formed body)
POST /api/ai/admin                 -> 401   (with a well-formed body)
```

**No unauthenticated exposure exists.** The initial `400`s were body-schema validation firing before
authentication — see UNW-P3-1 below.

---

## 2. Distribution

| By module | n | | By sensitivity | n |
|---|---|---|---|---|
| `admin.ts` | 15 | | ANALYTIC | 48 |
| `analytics.ts` | 14 | | OPERATIONAL | 24 |
| `ai-brain.routes.ts` | 12 | | MONEY | 13 |
| `providers.ts` | 8 | | PII/AUTH | 7 |
| `admin-governance.ts` | 5 | | | |
| `ai-gateway.routes.ts` | 4 | | | |
| 22 other modules | ≤3 each | | | |

---

## 3. Classification

### API-ONLY — correct as-is, no consumer expected (6)

`GET /metrics` · `GET /ready` · `POST /api/webhooks/resend` · `POST /api/payments/webhook` ·
`POST /api/payments/e2e/mock-signature` (gated) · `GET /uploads/ratings/*` (static)

**No action.**

### BACKGROUND / EXTERNAL_BLOCKED — do not wire while the pipeline is dead (18)

All of `analytics.ts` (14) plus `/api/mlops/metrics`, `/api/admin/ml/demand/forecast`,
`/api/admin/ml/shadow/*`, `POST /api/admin/ml/versions/*/transition`.

These are downstream of an ETL that has produced **zero successful runs since 2026-08-19**
(BigQuery billing). Wiring a console to them now would build a screen that reports stale data with
no indication why.

**Blocked on ETL-4.** Revisit once `homigo_etl_jobs_recovering_24h` reaches 0.

### ADMIN/OPS — objectively established consumer (2) — **1 WIRED THIS PASS**

| Endpoint | Evidence the consumer is established | Action |
|---|---|---|
| `POST /api/admin/fraud/commissions/*/unfreeze` | The fraud console already calls `freezeCommission`. Freezing was reversible in the backend and irreversible in the console — a commission frozen by mistake could only be released with database access | **WIRED** ✅ |
| `GET/POST /api/admin/governance/workflows/stuck` + `/recover` | Detector + recovery API + an automation console that displayed neither | **WIRED** (previous pass) |

`unfreeze` returns the commission to **review**, not to approved — the reviewer still decides. RBAC
rule already existed (`DISPUTES:UPDATE`), so no permission change was needed.

### PRODUCT-DECISION — do NOT invent a UX (24)

The recurring pattern: the console **already has a working action set**, and the orphan endpoint is
an *additional verb* whose need is a product question.

| Cluster | Why it is a decision, not a gap |
|---|---|
| `settlement-sync/discrepancies/*/investigate`, `/notes` | The settlement console already has **assign, resolve, escalate**. Whether "investigate" is a distinct state from "assign" is a workflow decision |
| `finance/fraud-cases`, `fraud/decisions` | The fraud console has overview, high-risk users, review queue, alerts, approve/reject/freeze/**unfreeze**/blacklist. These two are additional views |
| `finance/settlements/*`, `/export`, `finance/audit-export/*`, `liabilities/snapshot` | Finance already has dashboard, reconciliation, integrity, liabilities, reports |
| `providers/*/score/history`, `/career/history` | The partner detail page exists; whether it needs history timelines is a product call |
| `admin/ml/*`, `governance/models/*/evaluation`, `workflow-drafts` | Model evaluation surfaces — see §4 |
| `ai-brain.routes.ts` (12) | Conversation/context/prompt-version tooling. Moot until inference is live |

> **This corrects audit finding OPS-1.** The audit claimed "detection without remediation" across
> settlements and fraud. That was **overstated**: both consoles have working remediation. The one
> genuine asymmetry was `unfreeze`, now closed.

### CUSTOMER — real gap, blocked on product intent (6)

| Endpoint | State |
|---|---|
| `GET /api/customer-intel/me` | 0 consumers (verified) |
| `GET /api/customer-intel/recommendations` | 0 consumers (verified) |
| `GET /api/customer-intel/rebooking` | 0 consumers (verified) |
| `GET /api/customer-intel/maintenance` | 0 consumers (verified) |
| `POST /api/customer-intel/recommendation-click` | 0 consumers (verified) |
| `GET /api/customer-intel/satisfaction/*` | 0 consumers (verified) |

Admin **can** see customer intelligence (`/api/customer-intel/{userId}` and `/match`). Customers
cannot see their own.

**Not wired here.** Surfacing recommendations to customers is a product decision about placement,
ranking and whether a recommendation the customer did not ask for is welcome. The backend is ready;
the shortlist is in §5.

### PARTNER — split (9)

| Endpoint | Classification |
|---|---|
| `POST /api/providers/me/lifecycle/pause` · `/resume` · `GET /lifecycle/history` | **REAL GAP** — a partner cannot pause their own availability through any client, and there is no equivalent elsewhere |
| `GET /api/providers/me/withdrawals` | **REAL GAP** — partners cannot list their own withdrawals |
| `GET /api/providers/me/intel/{earnings-coach,nudges,shift-plan,zones}` | **DEPRECATE CANDIDATE** — a parallel backend. Partner web is already served by `/api/geo-intel/*` and `/api/providers/me/{forecast,intelligence}`, verified rendering real data |

**Not wired here.** `lifecycle/pause` changes dispatch eligibility; exposing it needs a decision about
whether a partner may self-pause mid-shift and what happens to offers in flight.

### INTERNAL / LOW (27)

`compliance/consent/withdraw` + `request/*` (see below), `legal/policies`,
`notifications/preferences/defaults`, `geo/checkin`, `partner/register/referral-code`,
`auth/google/mobile-callback`, `auth/sessions/*/activity`, `vision/images/*/analysis`,
`weather/{config,forecast}`, `knowledge/{ask,retrieve,scope}`, `wallet/checkout/multi-source/*`,
`digital-twin/*/what-if`, `users/{bookings,ratings,me/devices,me/export}` variants, and the rest.

### COMPLIANCE — stands as a P1 (2)

`POST /api/compliance/consent/withdraw` and `GET /api/compliance/request/*` remain unreachable from
any client. Under DPDP/GDPR a data subject must be able to withdraw consent and track a request.
**This is the one customer-facing gap that is a legal requirement rather than a product preference**,
and it should be wired ahead of anything in §5.

---

## 4. ML evaluation surfaces — deliberately not wired

`governance/models/cancellation-risk/evaluation` and `provider-acceptance/evaluation` expose two
genuine logistic regressions. Both remain **EVALUATION-ONLY** and drive no decision.

Building a console for them would imply they are ready to act on. Under Phase 12 neither may be
connected to refunds, payouts, money or customer eligibility without a validated policy. The right
next step is a shadow-decision period, not a dashboard.

---

## 5. Evidence-backed shortlist, in order

Not a mandate — a proposal with the reason each earns its place.

| # | Capability | Why first | Blocked by |
|---|---|---|---|
| 1 | **Consent withdrawal + DSR status** (customer) | Legal requirement, backend complete, no product ambiguity | nothing |
| 2 | **Partner self-pause / resume / withdrawals** | No equivalent exists anywhere; partners currently cannot pause | dispatch policy decision |
| 3 | **Customer intelligence** (6 endpoints) | Largest revenue-adjacent surface already built | product decision on placement |
| 4 | **AI budget UI** | Must exist before a provider key is added | — |
| 5 | Retire `providers/me/intel/*` | Duplicate backend, zero callers | confirm `geo-intel` covers it |
| 6 | Analytics/MLOps consoles | 18 endpoints | **ETL-4** |

---

## 6. New finding

### UNW-P3-1 (P3, SECURITY) — body validation runs before authentication

An unauthenticated caller receives `400 VALIDATION_ERROR` for a malformed body and `401 UNAUTHORIZED`
for a well-formed one, so anonymous callers can distinguish the two and infer schema shape.

Not a vulnerability — no data is returned and auth is enforced — but it leaks structure and does
validation work for unauthenticated requests. It follows from Elysia running the `body` schema in the
validation phase, ahead of the auth plugin's hook, so changing it is framework-level and affects
every route uniformly.

**Recorded, not fixed.** The fix is global and its blast radius is larger than the finding.

---

## 7. Status

| Category | Count | Status |
|---|---|---|
| API-ONLY (correct as-is) | 6 | `NOT_APPLICABLE` |
| Background / blocked on ETL | 18 | `EXTERNAL_BLOCKED` |
| Wired this pass | 1 | **`RUNTIME_VERIFIED` pending regression** |
| Wired previous pass | 2 | `WIRED` |
| Product decision | 24 | `BUSINESS_DECISION` |
| Customer gap (verified) | 6 | `DISCONNECTED` |
| Partner gap | 4 | `DISCONNECTED` |
| Partner duplicate backend | 4 | `DEPRECATE` candidate |
| Compliance (legal) | 2 | **`DISCONNECTED` — P1** |
| Internal / low | 27 | `INTERNAL` |
