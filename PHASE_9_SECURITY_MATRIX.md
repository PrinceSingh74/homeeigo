# PHASE 9 — Security Matrix

What each control is, where it is enforced, and what proves it. A control with no evidence column
entry is not a control — it is an intention, and it is marked as one.

Last updated 2026-09-01, after Capability 12.

## Standing invariants

| Invariant | Enforced at | Evidence |
|---|---|---|
| AI cannot execute a HIGH_RISK action | `tool-registry` — 14 HIGH_RISK tools, **0 handlers bound**; `execution-engine` throws `NO_HANDLER` | Probed live: `registry HIGH_RISK: 14 bound: 0`. Asserted in `approval-center.integration.test.ts` and re-asserted after every capability. |
| A HIGH_RISK request without an approval raises one and executes nothing | `execution-engine.ts` — returns `DENIED` / `APPROVAL_REQUIRED` and writes the audit row | Live: 212 of 245 HIGH_RISK executions are DENIED. |
| An approval authorises one tool, one actor, one argument set, once | `consumeApproval` — `argumentsHash` is the sole binding, claimed atomically via a conditional update | 32-test suite: tool, actor and four argument substitutions all refused; 10-way race yields exactly 1 winner against 10 for an unguarded claim. |
| An approver is never the requester | `decideApproval` → `SELF_APPROVAL_DENIED` | Refused in both directions by test; **0 self-approved rows** in 106 live approvals. |
| The approver's identity comes from the session | `/approvals/:id/decide` reads `requireAuth()`, gates on `requireAdmin(role)` | Route source asserted to contain `approverId: userId` and no `body.approverId` / `body.adminId` / `body.userId`. |
| `argumentsPreview` is display-only and never authorisation | `previewForStorage` → `redactArguments` on write; consumption reads only `argumentsHash` | Rewriting the stored preview changes nothing about what may execute; hashing the redacted view is refused as `APPROVAL_TAMPER`. |
| Secrets never reach the approval record | `redactArguments` — 19 sensitive key patterns, recursive through objects and arrays, plus Luhn-checked card scrubbing in free text | `apiKey`, nested `cvv`, `token` inside an array and a UPI handle all absent from the stored preview; a card-shaped number in free text replaced. |
| Prose cannot authorise anything | Every Phase-9 service is deterministic; no LLM is in any path | Asserted by test in capabilities 1–9; instruction-shaped text in an approval preview and in a decision reason both proven inert in capability 10. |

## Per-capability write surface

Every Phase-9 service reads. None writes business state. The claim is structural, not a promise:
each suite compares business-table counts across the whole run.

| # | Capability | Business writes | Telemetry writes | Approval / high-risk path reachable |
|---|---|---|---|---|
| 1 | Executive Intelligence Context | none | none | no |
| 2 | KPI Explanations | none | none | no |
| 3 | Revenue Anomaly Intelligence | none | none | no |
| 4 | Demand / Supply Warnings | none | none | no |
| 5 | Finance Narratives | none | none | no |
| 6 | Fraud Narratives | none | none | no |
| 7 | Forecast Explanations | none | none | no |
| 8 | Digital Twin Narratives | none | nine (`setGauge`, `incCounter`, `observeHist`) — disclosed in the narrative | no |
| 9 | Recommended Actions | none | none | no — imports no executor, creates no approval |
| 10 | Human Approval Center | approval rows only, on the isolated DB | none | yes, by design — and nothing executed: seven business tables unchanged |
| 11 | Scheduled Executive Reports | none | none | no — asserted absent: no `executeTool`, `consumeApproval`, `refund`, `payout`, `settlement` |
| 12 | Admin Integration | none | none | no — all three routes are GET; the brief panel contains no mutation hook, no POST and no approve affordance |

Capability 8 is the one row that is not "none", and it is stated rather than glossed: calling
`simulate()` increments `digital_twin_scenarios_total`. That is technical persistence, not business
state, and the narrative discloses it instead of describing itself as read-only.

## Capability 11 additions

| Invariant | Enforced at | Evidence |
|---|---|---|
| A report recipient cannot be supplied, only derived | `resolveReportRecipients()` reads the admin role table and takes no arguments | `resolveReportRecipients.length === 0`; every `payload.*` read in the job handler is extracted and the set is exactly `["period"]`; four forged payloads (recipientId/adminId/email, SQL, a number, a `toString` trick) change nothing |
| A scheduled report cannot send | `executionMode: "SHADOW"` is a literal in the delivery module | asserted that `"LIVE"` never appears and that the field is never assigned from a variable |
| No adapter is reachable from report logic | delivery goes only through `routeNotification` | asserted absent: `nodemailer`, `smtp`, `expo.dev`, `pushAdapter`, `sendSms`, `twilio`, `slack` — checked against comment-stripped source |
| No figure or contact detail leaves on a notification | the two templates declare exactly five count/state variables | asserted absent from title and body: gmv, revenue, margin, amount, email, phone, ₹ — and no free-text variable exists |
| A disabled capability costs nothing | `evaluateFlag` is checked before the schedule and before any source read | a full run under the shipped config refuses at `EXECUTIVE_REPORT_FLAG_DISABLED` with `report: null` and unchanged business counts |
| A missing flag row is off | `evaluateFlag` returns false for a missing row, an unreadable store and an unparseable rollout | the `ADMIN_EXECUTIVE_SCHEDULED_REPORTS` row is asserted absent from the database |

## Capability 12 additions

| Invariant | Enforced at | Evidence |
|---|---|---|
| The console cannot widen backend access | `adminRbacPlugin` on every intelligence route; the UI only renders what the route returned | Six cases through the real middleware: 401 no token, 401 forged token, refused customer token, 403 ADMIN-role user with no `AdminUser` row, 403 support admin without `ANALYTICS/READ`, 403 finance admin on recipients. `data` undefined in all six. |
| No permission was invented | route table quoted from the existing intelligence rules | All three routes resolved through the real resolver and checked against the `AdminResource` / `AdminAction` enums; the route module contains no `requiredPermission` or `hasPermission` of its own |
| A spoofed period cannot change the report | Elysia schema `t.Union` of the five supported periods | `hourly`, SQL injection, `DAILY` and `1` all rejected **400**, never coerced to a default window |
| Recipients expose no contact detail | the endpoint maps to four fields | Keys asserted exactly `adminId, basis, roleName, userId`; payload asserted to contain no `@` and no 10-digit sequence |
| The console never invents a value | shared guards in `lib/intelligence-render.ts` | 12 absent shapes x 4 renderers; the serialised API payload asserted free of `undefined`, `NaN` and `[object Object]`; nothing absent renders `0`, `0%` or `0/100`, while a real zero still renders |
| A missing schedule is never shown as scheduled | `ScheduledReportStatus` renders literal words | "Schedule not configured", "Never run", "None scheduled"; no `08:00`, `daily` or `Asia/Kolkata` default reachable |
| Reading intelligence mutates nothing | all handlers are reads | Opening all three endpoints leaves 9 business counters identical; no feature-flag row created; no `ScheduledJob` of the report type exists |

## Known weaknesses, stated

| Weakness | Why it is not repaired here |
|---|---|
| The argument hash is order-sensitive, so a legitimate re-execution with reordered keys is refused | Fail-closed — it can lose an approval, never forge one. Canonicalising it would silently invalidate all 106 approvals in the database. Frozen Phase-5 code; referred to its owner. |
| `NO_HANDLER` consumes the approval before any audit row is written, so a spent approval can name an execution that does not exist (10 of 43 live) | Nothing executes; what is lost is auditability and the approval itself. The two candidate fixes differ in risk, and the choice belongs to the freeze owner. Pinned by test so it cannot drift silently. |
| Every high-risk tool takes the same `{ payload }` shape, so identical arguments hash identically across different tools | Already mitigated: `consumeApproval` re-derives tool, actor and expiry from the stored row rather than trusting the hash alone. Proven by the `APPROVAL_WRONG_TOOL` case. |
| The live pending queue is empty, so the admin screen currently shows nothing | That is the real state of the platform, not a defect, and it is reported rather than seeded. |
| Five `AUDIT_LOGS`/`EXPORT` rules are unreachable behind a broad `GET /api/admin/finance/` prefix rule, so every financial export gates on `PAYMENTS/READ` | Measured, not read: FINANCE_ADMIN (5 active admins) holds `PAYMENTS/READ` and can download the executive report PDF, the ledger audit export and settlement/chargeback exports; **no role holds `AUDIT_LOGS/EXPORT` at all**. Reordering the rules makes those exports SUPER_ADMIN-only and removes access five administrators use today — an access-policy decision, not a code cleanup. Capability 11 avoided repeating it: its own permission is quoted from the existing `ANALYTICS`/`READ` rules and asserted by test. |
| The partner-facing "pending earnings" figure has always been exactly ₹0 | `earnings-live.service.ts` filtered `paymentStatus === "pending"`, but `EarningSettlementStatus` is `CREDITED \| REVERSED` and live data is 172 rows all `credited`. The predicate could never match. Behaviour is deliberately unchanged — the authoritative notion of pending money here is withdrawal-based, and repointing a partner's money figure at a different definition is a business decision, not a type fix. Recorded as `PENDING_EARNING_SEMANTICS_HUMAN_DECISION_REQUIRED`. |
| A template-registration error silently disables the event outbox and the scheduled job processor | `bootstrapWorkflows()`'s catch in `maintenance.ts` logs `workflow_bootstrap_failed` and returns before both processors start. Nothing alerted on that log for three days. The specific trigger is fixed and pinned by test; the boot path's fail-silent shape is not changed here. |

## What was deliberately not done

No HIGH_RISK tool was bound. No feature flag was created or enabled. No certification was modified.
No migration was applied to `homigo_db`, and no suite writes to it. No approval engine was rebuilt —
the existing one was reused, which was the requirement.
