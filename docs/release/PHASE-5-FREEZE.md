# Phase 5 — Tool & Action Governance Foundation — FREEZE

## 1. Freeze identity

| Field | Value |
|---|---|
| Freeze name | Phase-5 Tool & Action Governance Foundation |
| Scope | Tool registry, policy engine, approval engine, execution engine, tool bridge, discovery, result sanitisation, and the admin approval queue |
| Base HEAD | `42a7f4a` — *docs(ai): ADR-020, security review, and AI Core certification evidence* |
| Freeze commit | `feat(ai): freeze phase 5 tool governance foundation` — SHA recorded in §3 |
| Branch | `cursor/stage-e-step-13-certification` |
| Date | 2026-08-11 22:27 IST |
| Environment | Local development only. Production not accessed, not modified, not deployed. |

## 2. What "frozen" means here

The contracts in §9–§11 are settled. Later work — the first financial handler above all — builds
*on* them and must not reopen them. A change to an approval binding, to the idempotency identity,
to `INDETERMINATE` semantics, or to the compensation model is a new decision requiring its own
review, not an implementation detail of whatever handler comes next.

Freezing is not a claim of completeness. §14 states plainly what is absent.

## 3. Freeze commit SHA

Recorded post-commit. A commit cannot contain its own SHA, so the value is captured in the
certification report accompanying this freeze and is reproducible with:

```
git log -1 --format=%H -- docs/release/PHASE-5-FREEZE.md
```

## 4. Allowlisted files (31)

Every path below was inspected against `42a7f4a` before staging. Nothing was staged with
`git add -A`. Files carrying unrelated worktree work were rejected — see §14.

**Backend — tool governance (13)**

`src/ai-tools/types.ts` · `config.ts` · `registry/tool-catalog.ts` · `registry/tool-discovery.ts` ·
`policy/policy-engine.ts` · `policy/policy-rules.ts` · `approval/approval-engine.ts` ·
`execution/execution-engine.ts` · `security/tool-security.ts` · `security/tool-result-safety.ts` ·
`bridge/tool-bridge.ts` · `src/lib/ai-tools-metrics.ts` · `prisma/schema.prisma`

**Backend — gateway integration (4)**

`src/ai/types.ts` · `src/ai/providers/model-providers.ts` · `src/ai/gateway/ai-gateway.ts` ·
`src/routes/ai.ts`

**Backend — omission repair (1)**

`src/lib/request-identity.ts`. This file is *not* new Phase-5 work. It was authored during Phase 3/4
and left out of commit `0af337b` while two committed routes (`routes/ai.ts`, `routes/ai-gateway.routes.ts`)
import it. `42a7f4a` therefore does not typecheck from a clean checkout. Including it here repairs
that; see §12.

**Migrations (5)** · **Admin panel (6)** · **Evidence docs (2)** — enumerated with blob SHAs in §5.

## 5. Blob SHA per frozen file

Content-addressed; independent of the commit SHA, so each can be verified individually with
`git rev-parse HEAD:<path>`.

| File | Blob (12) |
|---|---|
| `apps/admin-panel/src/app/(console)/ai-brain/approvals/page.tsx` | `d47090100543` |
| `apps/admin-panel/src/app/(console)/ai-brain/memory/page.tsx` | `ede8efa13acd` |
| `apps/admin-panel/src/app/(console)/ai-brain/page.tsx` | `2eb3b4ac5d19` |
| `apps/admin-panel/src/app/(console)/ai-brain/timeline/page.tsx` | `e4fae1a64fd5` |
| `apps/admin-panel/src/app/(console)/ai-brain/tools/page.tsx` | `0ad1ba26d42e` |
| `apps/admin-panel/src/lib/hq-navigation.ts` | `b5649f36e026` |
| `apps/backend/prisma/migrations/20260811160000_ai_tool_approval_consumption/migration.sql` | `3003193c810c` |
| `apps/backend/prisma/migrations/20260811160500_ai_tool_approval_consumption_columns/migration.sql` | `819d2961f51c` |
| `apps/backend/prisma/migrations/20260811170000_ai_tool_confirmation_tier/migration.sql` | `d1070b734c74` |
| `apps/backend/prisma/migrations/20260811190000_ai_tool_approval_review_payload/migration.sql` | `f6bd96062393` |
| `apps/backend/prisma/migrations/20260811210000_ai_tool_indeterminate_outcome/migration.sql` | `081b2392a816` |
| `apps/backend/prisma/schema.prisma` | `202022be842a` |
| `apps/backend/src/ai-tools/approval/approval-engine.ts` | `8f805cde718e` |
| `apps/backend/src/ai-tools/bridge/tool-bridge.ts` | `238c9f95c2b3` |
| `apps/backend/src/ai-tools/config.ts` | `8b0ad772da03` |
| `apps/backend/src/ai-tools/execution/execution-engine.ts` | `d8e5d6e69434` |
| `apps/backend/src/ai-tools/policy/policy-engine.ts` | `397e85f78192` |
| `apps/backend/src/ai-tools/policy/policy-rules.ts` | `8ec2de6e4c4f` |
| `apps/backend/src/ai-tools/registry/tool-catalog.ts` | `388061cdfdfb` |
| `apps/backend/src/ai-tools/registry/tool-discovery.ts` | `b1a22302d30e` |
| `apps/backend/src/ai-tools/security/tool-result-safety.ts` | `aa1d88f2d61c` |
| `apps/backend/src/ai-tools/security/tool-security.ts` | `63866a61fdb8` |
| `apps/backend/src/ai-tools/types.ts` | `9a1fedc65b52` |
| `apps/backend/src/ai/gateway/ai-gateway.ts` | `37a23fdde74f` |
| `apps/backend/src/ai/providers/model-providers.ts` | `c3f439928e1b` |
| `apps/backend/src/ai/types.ts` | `3ebb6e6ce877` |
| `apps/backend/src/lib/ai-tools-metrics.ts` | `37a588c9edbe` |
| `apps/backend/src/lib/request-identity.ts` | `87dd174ab593` |
| `apps/backend/src/routes/ai.ts` | `4e20cd78593e` |
| `docs/phase5-evidence/HIGH-RISK-EXECUTION-READINESS.md` | `d51b414273d8` |
| `docs/phase5-evidence/PHASE-5-TOOL-ACTION-CERTIFICATION.md` | `3dbe3cc0d848` |

## 6. R1–R5 status

| ID | Finding | Status | Closed by |
|---|---|---|---|
| R1 | An approval was not bound to the arguments it authorised | **CLOSED** | `argumentsHash` compared at consume time; a mutated argument fails with `APPROVAL_TAMPER` |
| R2 | An approval could authorise more than one execution | **CLOSED** | Atomic `updateMany … where status='APPROVED'` → `CONSUMED`; a second attempt gets `APPROVAL_ALREADY_CONSUMED` |
| R3 | Catalog entries named services that did not exist | **CLOSED** | Verified per service. **One** phantom — `admin.service.suspendProvider` — now `INACTIVE`. `financialAdjustmentService.execute()` and `settlementSyncService.runSync()` both exist; an earlier claim of three phantoms was wrong and is corrected here. |
| R4 | A side-effecting call that timed out was recorded as failure | **CLOSED** | `INDETERMINATE` / `OUTCOME_UNKNOWN` for non-READ timeouts, plus replay protection (§10) |
| R5 | No stated contract for undoing a completed high-risk action | **CLOSED (policy)** | Compensation model in §11. No compensation code exists yet, by design. |

## 7. IC-1 evidence

`44 passed / 0 failed`, covering the approval → execution path end to end, including the
regression that produced IC-1: an earlier revision checked for a handler *before* consuming the
approval, which short-circuited every high-risk request to `NO_HANDLER` and meant the approval
bindings were never evaluated at all. The order is now **consume → handler**, and IC-1 fails if it
is reversed.

## 8. Regression evidence

| Suite | Result |
|---|---|
| IC-1 approval/execution | 44 / 44 |
| Phase 5 tool & action | 59 / 59 |
| Phase 4 memory & context | 27 / 27 |
| Context pipeline | 39 / 39 |
| AI Core | 54 / 54 |
| ETA assertions | 30 / 30 |
| Prompt injection — malicious | 16 / 16 blocked |
| Prompt injection — benign | 10 / 10 allowed |
| Backend `tsc --noEmit` | 131 errors — **0 new**, 2 fixed (see §12) |
| Admin `tsc --noEmit` | 0 errors |
| Admin `next build` | success; `/ai-brain/approvals` present in the route manifest |

## 9. Frozen approval contracts

An approval authorises **exactly one execution of one tool with one set of arguments by one
requester within one window**. All six bindings are checked at consume time, not issue time:

| Binding | Failure code |
|---|---|
| Approval exists | `APPROVAL_NOT_FOUND` |
| Status is `APPROVED` | `APPROVAL_NOT_APPROVED` |
| Not expired **at the moment of use** | `APPROVAL_EXPIRED` |
| Tool matches | `APPROVAL_WRONG_TOOL` |
| Requester matches | `APPROVAL_WRONG_ACTOR` |
| `argumentsHash` matches | `APPROVAL_TAMPER` |
| Not already spent | `APPROVAL_ALREADY_CONSUMED` |

Additionally frozen:

- **Self-approval is refused at decide time** — a requester cannot approve their own request.
- **`argumentsPreview` and `resourceRef` are for human eyes only.** `argumentsHash` remains the
  sole authorisation binding, so altering the preview cannot widen what an approval permits.
- **Consumption is atomic.** The claim is a conditional `updateMany`; `count !== 1` means someone
  else won the race and the execution is refused.
- **An ADMIN role does not bypass any of this.** Being an admin is not an approval.

## 10. Frozen INDETERMINATE semantics

A non-READ tool that times out is recorded `INDETERMINATE` with `OUTCOME_UNKNOWN` — *not*
`FAILED`. The distinction is the whole point: `FAILED` reads as "nothing happened", and acting on
that assumption after a money-moving call is how a double refund occurs.

- `INDETERMINATE` participates in idempotency replay. A retry with the same key returns the
  original record instead of executing again.
- The derived idempotency key is `ai-approval:<approvalId>` whenever an approval is present, so
  the approval itself is the deduplication identity.
- Resolution is reconciliation against the downstream system, performed by a human. It is never
  automatic retry and never automatic reversal.

Current retry surface: 29 READ tools retry (safe), 2 notification WRITE tools retry (a duplicate
notification, not money), **0 high-risk tools retry**.

## 11. Frozen compensation policy

The financial ledger is journal-based — append-only, with reversal entries. Nothing is deleted or
rewritten. From that:

1. There is **no automatic rollback** of a completed high-risk action.
2. A reversal is itself a high-risk action requiring its own, separately approved request.
3. `INDETERMINATE` is **not** grounds for reversal. Reconcile first, then decide.
4. Compensation therefore involves a human twice: once to approve the original action, once to
   approve the reversal.

No compensation code exists in this freeze. The policy is frozen so the first handler is written
against it rather than inventing its own.

## 12. Two corrections this freeze makes to the repository

**A missing migration file.** `20260811160000_ai_tool_approval_consumption/` contained a second
file, `migration_columns.sql`, holding the three `consumed_*` column additions. Prisma executes
only `migration.sql` from each migration directory and ignores every other file — verified against
the 40 committed migration directories, each of which has exactly one file. Those columns would
therefore never have been created by `prisma migrate deploy`, and `consumeApproval()` would fail at
runtime on any freshly migrated environment. The statements now live in their own directory,
`20260811160500_ai_tool_approval_consumption_columns/`, which also guarantees the separate
transaction that PostgreSQL requires after `ALTER TYPE … ADD VALUE`.

Verified by replaying all five Phase-5 `migration.sql` files against a scratch database cloned from
the dev schema with the `consumed_*` columns dropped: all five applied, and `consumed_at`,
`consumed_by`, `consumed_execution_id`, `arguments_preview`, `resource_ref`, `CONSUMED`,
`INDETERMINATE` and `REQUIRES_CONFIRMATION` were all present afterwards.

**A file missing from `0af337b`.** `src/lib/request-identity.ts` — see §4. Its absence is the
source of the only two typecheck errors this freeze removes.

## 13. Explicit non-implementation

- **No financial handler is implemented.** All **14** high-risk tools have **zero** executable
  handlers — verified at runtime against the registry, not asserted from reading code. Every
  high-risk request consumes its approval and then terminates at `NO_HANDLER`, fail-closed.
- **No production financial execution is enabled.** No production secret, database, Cloud Run
  service, environment variable or feature flag was modified. Nothing was deployed or pushed.
- No authoritative financial service was modified. No approval, idempotency, timeout or
  compensation control was weakened.
- ETA ML inference remains off; no ETA model was trained or promoted; Google Maps remains the
  customer-facing ETA source.

## 14. Known limitations

1. **The end-to-end high-risk path has never executed a real side effect**, because no handler
   exists. Everything past `NO_HANDLER` is unproven by construction.
2. **The backend typecheck is not clean** — 131 pre-existing errors, unchanged by this freeze.
   An earlier report in this workstream cited a baseline of 83; that figure was produced by a
   truncated count and was wrong. The true `42a7f4a` baseline is **133**, measured in a detached
   worktree at that commit. This freeze takes it to 131.
3. **The repository does not migrate cleanly from an empty database.** A full `prisma migrate
   deploy` fails at `20260609160000_p3_gift_card_campaign_security` (`relation "gift_cards" does
   not exist`). That migration is pre-existing, uncommitted and outside Phase-5 scope; it is
   recorded here because it blocks whole-chain verification.
4. **Four admin pages in this commit are build-unblock, not Phase-5 logic.** They remove an
   invalid `trend` prop that made `next build` fail. Their diffs contain nothing else.
5. **Staging and production are unverified.** All evidence is local.
6. **17 pre-existing untracked migrations and 23 untracked test files** remain outside this freeze.
   They were deliberately not staged.

## 15. Frozen invariants

The freeze asserts each of the following, verified rather than assumed:

1. A high-risk tool cannot execute without an approval.
2. An approval authorises exactly one execution.
3. An approval is bound to its tool.
4. An approval is bound to its requester.
5. An approval is bound to its arguments by hash.
6. An approval expires, and expiry is checked at use.
7. A requester cannot approve their own request.
8. Consumption is atomic and survives a race.
9. The ADMIN role is not a substitute for approval.
10. Approval is consumed *before* the handler is looked up, so bindings always run.
11. An absent handler fails closed, never open.
12. A non-READ timeout is `INDETERMINATE`, never `FAILED`.
13. `INDETERMINATE` replays rather than re-executes.
14. No high-risk tool is retried automatically.
15. Tool arguments are never logged raw; only a hash is stored.
16. High-risk tools are never discoverable by the model.
17. Tool results are sanitised before re-entering a prompt.

## 16. Verification commands

```bash
# Frozen content
git rev-parse HEAD
git diff HEAD^ --stat
git rev-parse HEAD:apps/backend/src/ai-tools/execution/execution-engine.ts

# Invariants
cd apps/backend && bun <scratchpad>/ic1_cert.ts        # expect 44 / 0
cd apps/backend && bun <scratchpad>/phase5_cert.ts     # expect 59 / 0

# No high-risk handler exists
cd apps/backend && bun -e 'import{TOOL_CATALOG}from"./src/ai-tools/registry/tool-catalog";\
import{registerToolHandlers}from"./src/ai-tools/execution/handlers/index";\
const e=registerToolHandlers(TOOL_CATALOG as any);\
const h=e.filter((x:any)=>x.category==="HIGH_RISK");\
process.stdout.write(h.length+" high-risk, "+h.filter((x:any)=>typeof x.handler==="function").length+" with handler\n")'

# Migrations produce the required schema
# (replay the five 20260811* migration.sql files against a scratch DB — see §12)
```

## 17. Next sequence

Refund handler → sandbox refund → independent security certification → account freeze → ledger →
wallet adjustment → payout → settlement. Each builds on §9–§11 without reopening them.
