# PHASE 8 — P3-10: Type-Suppression Audit

**Status:** `P3_10_COMPLETE` · backend typecheck **0** · regression **211 pass / 0 fail** · boot clean
· HIGH_RISK freeze **0/14** · `homigo_db` untouched.

Optimised for **zero unjustified casts**, not zero casts.

---

## Metric

| | Count |
|---|---|
| Raw grep matches (`as unknown as`, `as never`, `as any`) in `src/` + `analytics/` | 51 |
| — of which prose/comments containing the word "never" (false positives) | 14 |
| **Real production casts found** | **37** |
| Removed / replaced | **31** |
| **Retained (all documented)** | **6** |
| Unjustified casts remaining | **0** |
| Casts in the original P3-8 inventory | 6 |
| **Casts the P3-8 inventory missed** | **31** |
| New defects discovered | **4** |

The P3-8 inventory listed 6 because it came from a truncated grep. The real figure was 37 across
26 files — including the entire `admin-partner-acquisition.ts` route module (12).

---

## New defects discovered

### 1. `REAL_APPLICATION_DEFECT` — WebSocket booking actions ran with an undefined user id

`booking.ws.ts` read identity as `(getWsState(ws) as any)?.userId`. `getWsState` already returns a
typed `WsState | undefined`, so the `as any` bought nothing — it *erased* the fact that `userId` is
`string | undefined`, and that value was passed straight into `acceptBooking`, `rejectBooking`,
`cancelBooking`, `startService` and `completeBooking`, every one of which requires a real user id.
Removing the cast produced 7 compiler errors, one per action.

This is the same shape as the P3-8 AI-tools cancel defect (an actor with an undefined user), and it
is not hypothetical here: the `stateKey` comment in `ws-state.ts` records that `getWsState` HAS
missed for a live socket when the key was unstable.

**Fixed** with a single fail-closed guard — no identity, no action, error frame returned.

### 2. `REAL_APPLICATION_DEFECT` — the payment-gate override query was never typechecked

`hasAuditedPaymentGateOverride` declared its client as
`{ activityLog: { findFirst: (args: unknown) => Promise<unknown> } }`, defaulted `prisma as never`.
A parameter typed `unknown` obliges the implementation to accept *any* argument, so the real client
was not assignable — hence the cast. The larger problem: with `args: unknown` the query inside was
**not typechecked at all**. A misspelled `action` or a wrong field would have compiled, and on this
function that is a payment control silently returning the wrong answer — either blocking a partner
an admin deliberately dispatched, or reporting an override nobody granted.

**Fixed** to `Pick<PrismaClient, "activityLog">`. Enabling real checking surfaced **no** errors, so
the query shape was correct — it had simply never been verified. The matching `tx as never` at the
`booking.service.ts` call site dropped out with no cast needed.

### 3. `REAL_APPLICATION_DEFECT` — the Vertex cast hid a nullability gap

`client as unknown as { generateContent: ... }` looked like it was bridging a missing SDK method.
It was not: `PredictionServiceClient.generateContent` **is** declared. Removing the cast revealed
the actual mismatch — the SDK's `IGenerateContentResponse` marks `candidates`, `content`, `parts`
and `finishReason` as `| null`, while the hand-written local type declared them merely optional.
`fromGeminiResponse` already optional-chains through all of it, so there was no runtime failure —
but a second, drifting copy of a vendor contract was being maintained by hand.

**Fixed** by using the SDK's own generated type and normalising `finishReason` (a protobuf enum
that can be a string *or* a number) once at the boundary.

### 4. `REAL_APPLICATION_DEFECT` (cluster) — 12 admin routes accepted unvalidated input

`admin-partner-acquisition.ts` pushed raw request values into typed service parameters with
`as never` at 12 sites, and four GET routes declared **no query schema at all**. Any string reached
`PartnerLeadStatus` / `PartnerLeadSource` / `PartnerLeadActivityType` / `ApplicationPipeline`
filters and enum columns, failing at the query as a 500 rather than at the edge as a 400. The tell
was `followUp` in `/leads`, already given a proper union while its immediate neighbours were not.

Merge resolutions were the sharpest case: `t.Record(t.String(), t.String())` forced into
`Partial<Record<MergeFieldKey, "primary" | "duplicate">>` — an unknown field or an invalid choice
could enter a merge that rewrites lead data. Now constrained on both keys and values, derived from
the exported `MERGE_FIELDS` tuple.

**Fixed** end to end. Runtime-verified: `status=NOT_A_STATUS` → **400**, `status=CONTACTED` → 401
(auth gate); `source=NOT_A_SOURCE` → **400**, `source=REFERRAL` → 401; `pipeline=BOGUS` → **400**,
`pipeline=kyc` → 401.

> While writing the union lists, `as const satisfies` caught two transcription errors of my own —
> `NEW` is not a `PartnerLeadSource`, and I had missed `WITHDRAWN` from `PartnerLeadStatus`. That is
> precisely the drift the construct exists to prevent.

---

## The six originally named (all removed)

| Cast | Verdict | Resolution |
|---|---|---|
| `brain-security.ts` `role as never` | **Obsolete** | `validatePromptSecurity(input, actorRole: string)` already takes `string`; leftover from a narrower signature. Removed, 0 errors. |
| `activity-timeline.ts` `status as never` | Stale type | Filter typed `string` against an `AiRequestStatus` column. Fixed at source; no caller passes it. |
| `approval-engine.ts` `redactArguments(...) as never` | Needed validation | Json column. `redactValue` passes primitives through, so `undefined`/NaN/BigInt can survive into the preview. Now validated; if unstorable, the **approval is still created** and the approver is told the preview is missing rather than shown a blank. |
| `context-cache.ts` ×3 | **Latent defect** | The read asserted arbitrary DB JSON *was* an `EnterpriseBuiltContext`. A row written by a previous deploy yields required fields that are `undefined` — and that object is injected into the model's prompt, so it degrades an answer rather than raising an error. Now shape-guarded; a mismatch is a **miss**, so the context rebuilds and the stale row is overwritten. |
| `context-snapshot.ts` | Needed validation | Json array; validated via a new `toInputJsonArray`. Forensic and best-effort, so an unstorable list skips the row. |
| `model-providers.ts` | **Defect #3 above** | Replaced by the SDK's generated type. |

Deliberately **not** reported through `recordContextCacheDenied`: that counter is documented as an
actor-isolation alert that should sit at zero, and a shape change is not a security event.

## Other removals

- **`event-publisher.ts` ×2** — outbox payload. Validated, but **throws** rather than returning
  null: everywhere else an unstorable value means "don't cache", which is harmless; here the row
  *is* the event, and skipping it would silently break the transactional outbox guarantee. The
  throw aborts the transaction so the business change and its event fail together.
- **`workflow-registry.ts` ×3** — the read-back `current.steps as unknown as WorkflowStep[]` claimed
  the database held typed steps. The comparison is structural (canonicalise + hash), not semantic,
  so it now uses `fingerprintStoredSteps(unknown)`. Same fail-closed outcome, without the pretence.
  The two write casts became validated `toInputJsonArray`, throwing rather than writing a workflow
  with missing steps.
- **`geofence.service.ts` ×5** — four read casts to `GeofenceLite[]` were **entirely obsolete**
  (Prisma's result is directly assignable). The polygon write is now validated.
- **`payments.ts`** — `reconcileFromWebhook(event as never)`. The route described the body loosely
  and the service precisely; now one exported `RazorpayWebhookEvent` type, stated once, on a money
  path. Signature verification still happens **before** parsing, unchanged.
- **`compliance.service.ts` + `routes/compliance.ts`** — `status as never` with a `t.String()`
  schema; now the real `ComplianceRequestStatus` union plus the `ALL` sentinel.
- **`vision-intelligence.service.ts` ×2** — the local type derived `observationMode` wholesale from
  `fallbackAnalysis`, whose value is the literal `"FALLBACK"`, so every real-provider assignment
  needed a cast. Widened to the column enum. **No governance decision made**; which mode is
  recorded is unchanged, including the deliberate REAL_PROVIDER-on-failure behaviour.
- **`notifications/templates/registry.ts`** — obsolete; `Record<string, VariableType>` is directly
  assignable.
- **`partner-lead-state-machine.ts`** — `leadStatusForOnboardingStep` is deliberately TOTAL (unknown
  input falls through to APPLICATION_SUBMITTED) and its only caller passes a free-form
  `metadata.targetStep`. Declaring `step: string` states the contract that already held; asserting
  `as never` had claimed a check that never happened.
- **`routes/coverage.ts`** — `routes as unknown as Elysia` existed only to keep `index.ts` under
  TypeScript's instantiation-depth limit. Segmenting that chain in P3-8 removed the cause, so the
  workaround is now obsolete and the real inferred type is checked. Stale comment corrected.
- **`lib/observability.ts`** — a genuine dynamic boundary (optional package, non-literal specifier),
  but it was **asserted**, not checked. Now `isSentryLike()` verifies the shape, so a package that
  resolves to something else produces a clear log line instead of a TypeError on `.init(...)`.

## Retained — 6, each documented in place

| Cast | Why it must stay | Removable when |
|---|---|---|
| `sanitizer.ts` ×2 | TypeScript cannot express "if `T` is `string`, the result is `string`" for a recursive generic identity function. Every branch provably returns the shape it received. Nothing untrusted, nothing stale. | The language can relate narrowed inputs to a generic return. |
| `prisma-base.ts`, `prisma.ts` (globalThis) | `globalThis` has no typed slot for an app's own singleton. `declare global` would publish the name program-wide — a *wider* claim for no safety gain. Written and read only by that module. | — |
| `prisma.ts` `$extends(...)` | `$extends` returns Prisma's extended client type, structurally distinct from `PrismaClient`. The runtime object is the real extended client, so the PII layer applies regardless. The type-accurate alternative re-types several hundred call sites with a type heavy enough to be a plausible TS2589 source. | Prisma's extended client becomes assignable to `PrismaClient`, or the codebase adopts one exported client type. |
| `load-env.ts` `BigInt.prototype` | `BigInt.prototype` genuinely has no `toJSON` in the standard lib types — that is why the shim exists. | TC39 adds `BigInt.prototype.toJSON`. |

## No-cheat compliance

No `@ts-ignore`, no `@ts-nocheck`, no `any` introduced, no `skipLibCheck` change, no tsconfig
exclusion, no assertion chain without runtime proof, no union widened merely to silence the
compiler. `strict: true` and `skipLibCheck: true` remain byte-identical to HEAD.

One cast was introduced **by me** mid-audit (`toInputJsonObject(context as unknown as Record<...>)`)
and removed immediately on noticing — the helper accepts `unknown`, so no cast was ever needed.

## Regression

Backend typecheck **0** (exit 0). **211 pass / 0 fail** across ai-tools, ai-tools-handler-contracts,
ai-brain, p3-9, p0/p1/p3/p4 security, p4-compliance, phase7-post-service-security,
partner-acquisition, partner-acquisition-automation, the three p3-8 suites, and the three event
suites.

Server boots clean on a fresh port (2s), `/health` `/metrics` `/api/services/featured`
`/api/subscriptions/plans` `/` all **200**, zero errors in the boot log. HIGH_RISK tools re-verified
**0/14 bound**.

**Known pre-existing failure, not introduced here:** `ai-gateway.test.ts` circuit-breaker case
(`"CLOSED"` vs `"closed"`), 14 pass / 1 fail — proven at HEAD during P3-8.

## Safety

No migrations applied, `homigo_db` unmodified, no certification mutated, LIVE not activated, no
HIGH_RISK tool bound, no historical evidence document rewritten.
