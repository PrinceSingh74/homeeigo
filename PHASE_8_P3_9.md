# PHASE 8 — P3-9: AI-Tools WRITE End-to-End Coverage

**Status:** `P3_9_COMPLETE` · **1 REAL_APPLICATION_DEFECT found, reproduced, fixed and re-verified**
· backend typecheck 0 · `homigo_db` provably unmutated.

---

## 1. Registry enumeration — and a methodology warning

| Category | Count | Handler bound (NODE_ENV=production) |
|---|---|---|
| READ | 29 | 29 / 29 |
| WRITE | 12 | 12 / 12 |
| HIGH_RISK | 14 | **0 / 14 — fail-closed** |
| **Total** | **55** | |

All 14 HIGH_RISK tools are `riskLevel=CRITICAL`, `approvalRequired=true` (13 ACTIVE, 1 DISABLED).
`financialSandboxVerdict()` returns `{allowed:false, reason:"PRODUCTION_ENVIRONMENT"}`, so
`registerToolHandlers` binds none of them. **Freeze state untouched; nothing was bound or
activated.** The catalog is byte-identical to the Phase-5 freeze commit `7ce2e71`.

> **Methodology warning.** A static/grep enumeration of the catalog reports **41** tools and
> **zero** HIGH_RISK, because the 14 high-risk entries are generated from a compact
> `([...] as const).map(...)` literal with shorthand keys. Only runtime enumeration of
> `TOOL_CATALOG` is authoritative. Any future audit that greps this file will silently miss every
> high-risk tool.

## 2. Chain audited

`tool registry -> policy engine -> actor resolution -> handler -> service -> database -> audit -> response`,
driven through the real `executeTool()` — not by calling handlers directly.

**Isolated database.** `homigo_p39`, created inside the `homigo-postgres` container as a
`pg_dump --schema-only` clone of `homigo_db` (188 tables). A schema clone rather than
`prisma db push` specifically to preserve the raw-`ALTER` constraints — confirmed when the seed hit
`bookings_user_slot_excl`, which `db push` would have dropped. Every harness script aborts unless
`current_database() = 'homigo_p39'`.

**`homigo_db` proof of non-mutation** — identical before and after all P3-9 work:
`bookings=405 wallet_txn=30 activity=78492 notifications=5601 payments=268`.

---

## 3. THE DEFECT — `REAL_APPLICATION_DEFECT`

### A failed job acceptance was reported to the partner as SUCCESS

`bookingService.accept()` **reports** refusal rather than throwing it: on a business refusal it
resolves with `{ ok: false, error: "PAYMENT_NOT_SETTLED" | "ALREADY_CLAIMED" | "INVALID_STATUS" | ... }`.
The handler returned that object unchecked, and the execution engine treats **any resolved value**
as success.

**Reproduced against a real booking (before the fix):**

```
ENGINE STATUS : SUCCESS
RESULT PAYLOAD: {"ok":false,"error":"PAYMENT_NOT_SETTLED"}
booking before: status=PENDING acceptedAt=null
booking after : status=PENDING acceptedAt=null      <- nothing happened
```

Consequences: the AI told the partner the job was accepted when it was not; the tool audit row
recorded SUCCESS; success metrics and the circuit breaker counted a healthy execution. This is
precisely the class of defect P3-8 predicted — the code typechecked perfectly.

`write.partner.rejectJob` had the identical shape (`{ error: ... }` returned unchecked).

### Why the obvious fix would have been worse

Simply throwing would have made every business refusal a *system* failure. `ALREADY_CLAIMED` is the
normal outcome when two partners race for one job, and the engine opens a circuit breaker after
**5** failures for 60s — so five ordinary race losses would have disabled `acceptJob` for **every
partner**. Non-HIGH_RISK tools also retry, which for a refusal just asks the same question again.

### The fix

`ToolDomainRejection` (new, in `src/ai-tools/execution/errors.ts`):

- recorded as **FAILED** carrying the domain's own error code — audit, metrics and the AI answer all
  say the action did not happen;
- **no circuit-breaker penalty** — a business rule saying "no" is not evidence the tool is broken;
- **never retried**.

It lives in a dependency-free leaf module because `execution-engine -> tool-registry -> handlers` is
already an import cycle; importing it from the engine would have deepened that cycle.

### Verification (isolated DB, real engine)

| Check | Result |
|---|---|
| Refused accept | `FAILED`, audit `errorCode=PAYMENT_NOT_SETTLED`, `policyDecision=ALLOW`, DB unchanged |
| 7 consecutive refusals (threshold 5) | circuit `failures=0 open=false` — **stayed closed** |
| Genuine accept | `SUCCESS`, `PENDING -> ACCEPTED`, `acceptedAt` set, +1 email, +2 outbox, +1 notification |

---

## 4. Security matrix — 9/9 denied, zero domain mutation

Every case returned `DENIED / POLICY_DENIED`; the only rows written were `ai_tool_executions` and
`ai_tool_policy_logs`.

| Attack | Result |
|---|---|
| CUSTOMER calls ADMIN-only notification tool | DENIED |
| CUSTOMER injects `admin:true, allUsers:true, role:"ADMIN", actorRole:"ADMIN"` | DENIED |
| CUSTOMER A cancels CUSTOMER B's booking (IDOR) | DENIED |
| CUSTOMER A spoofs `actorId`/`userId` in arguments | DENIED |
| PARTNER calls a CUSTOMER-only booking tool | DENIED |
| CUSTOMER calls PARTNER-only `acceptJob` | DENIED |
| PARTNER B accepts a job assigned to PARTNER A | DENIED |
| CUSTOMER self-asserts `confirmed:true` | DENIED |
| CUSTOMER forges an `approvalId` | DENIED |

**Positive controls prove the denials are meaningful** (an engine that denied everything would also
have scored 9/9): support-ticket creation, admin notification, booking create/reschedule/update,
coupon validation, ticket close and partner accept all SUCCEED with the correct domain writes.

Identity is server-derived from `actor.actorId` throughout. The only handlers taking `userId` from
arguments are the two notification tools, which require `ADMIN,SYSTEM` — verified by the first two
attack rows above. `resource.ownership` resolves a partner's provider id from the authenticated
user before checking access, so argument-supplied ids are never consulted.

## 5. Idempotency & concurrency — all PASS

| Test | Result |
|---|---|
| Same idempotency key twice (cancel) | both `SUCCESS` (2nd is a replay), **1** cancellation event |
| Two concurrent accepts, same partner | 1 `SUCCESS` + 1 `FAILED/INVALID_STATUS`; booking accepted once; **outbox +1, emails +1** — no duplicate customer notification |
| 5 concurrent calls, one key | exactly **1** ticket created |

The middle row is itself evidence of the fix: before it, **both** concurrent accepts would have
reported SUCCESS and this test would have been misleading.

Two different partners cannot race through the AI tool at all — `verifyPartnerBookingAccess`
admits only the partner the booking is already assigned to, so the tool path is strictly narrower
than the general dispatch path.

## 6. Other findings

**`HUMAN_DECISION_REQUIRED` — concurrent same-key requests surface a raw database error.**
Of 5 concurrent calls sharing one idempotency key, 1 succeeded and 4 threw Prisma `P2002` on
`idempotency_key` instead of returning the structured idempotent replay the engine gives sequential
retries. **No data-integrity impact** — exactly one ticket was created, which is the guarantee that
matters. It is a UX/robustness gap: the AI reports an error for a duplicate of a request that
actually succeeded. Deliberately **not fixed here**: the current behaviour is fail-closed and safe,
and changing the idempotency path is a poor trade to make late in a session for cosmetics. Flagged
for a decision.

**`TEST_COVERAGE_GAP` (closed).** `src/__tests__/p3-9-tool-domain-rejection.test.ts` — 6 tests
guarding the defect shape, the leaf-module placement, and the circuit/retry exemption.

**`HARNESS_DEFECT` (resolved during the audit).** A fresh database has no `ai_tool_registry` rows,
so the audit write fails FK and every execution throws. `seedToolRegistry()` must run first — worth
knowing for any future service-backed AI-tools test.

## 7. Excluded from scope

- **14 HIGH_RISK tools** — not bound, not activated, freeze state unchanged (per directive).
- Destructive WRITE operations against `homigo_db` — never executed; everything ran on `homigo_p39`.

## 8. Reproduction

Harness (untracked working material): `apps/backend/scratch-p39/` —
`seed.ts`, `lib.ts`, `sec-matrix.ts`, `positive.ts`, `e2e.ts`, `repro-accept.ts`,
`positive-accept.ts`, `circuit.ts`, `concurrency.ts`. Each requires
`DATABASE_URL=.../homigo_p39` and refuses to run against any other database.

## 9. Next

**P3-10** — suppression audit of the pre-existing `as unknown as` / `as never` casts recorded at the
end of P3-8.
