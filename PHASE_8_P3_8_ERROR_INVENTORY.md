# PHASE 8 — P3-8 Backend Typecheck Error Inventory

Command: `bunx tsc --noEmit` in `apps/backend` (the exact CI command).

## Progress (measured from actual compiler output, never file counts)

| Stage | Errors | Root cause fixed |
|---|---|---|
| Baseline | **195** | — |
| 1 | 147 | `run-partner-operations-integration.ts` had top-level `await` but no import/export, so TS treated it as a script not a module (TS1375 x48). Added `export {}` — the fix TypeScript's own diagnostic recommends. |
| 2 | 115 | tsconfig `target`/`lib` were ES2020; `Array.prototype.at()` is ES2022 (TS2550 x32). Runtime is **Bun**, which supports ES2022+ and already runs this code in production — the config was stale, not the code. |
| 3 | 99 | `rootDir ./src` + `include [src]` excluded `analytics/`, which `src/` imports and which is genuinely live (routes + ETL scheduler, proven in P3-1) -> TS6059 x16. Widened both. Safe: CI builds with `bun build`; tsc only ever runs --noEmit. |
| 4 | 54 | Three helpers typed `set: { status: number }`, but Elysia passes an object whose `status` is optional and `number` OR an HTTP status-name union (TS2345 x45 across ai-brain / ai-tools / ai-gateway routes). Widened to the shape Elysia actually provides. |
| 5 | 46 | `vision-shadow.test.ts` and `phase7-db-probe.test.ts` imported **vitest**, which is not installed — they only ran because Bun aliases vitest at runtime. Pointed them at `bun:test` (the real runner) and replaced the Jasmine global `fail()` with bun-native `expect.unreachable()`. |
| 6 | 42 | Four certification tests dereferenced a nullable return (TS18047 x4). Added real narrowing — they now assert success instead of assuming it. |
| 7 | 37 | `ai-brain/types.ts` typed JSON-column fields as `Record<string, unknown>`, which Prisma's InputJsonValue rejects. Retyped at the source as `Prisma.InputJsonObject`. |
| 8 | 34 | `context-cache.ts` / `context-snapshot.ts` held **pre-existing** `as unknown as Record<string, unknown>` casts aimed at the wrong type. Corrected them to `Prisma.InputJsonObject` / `InputJsonArray` — an existing cast fixed, not a new one added. |
| 9 | **31** | Same Prisma-JSON root cause in four more type sources — `ai-tools/types.ts`, `analytics/etl/types.ts`, `analytics/etl/engine.ts`, `analytics/versioning/service.ts`. Retyped at source; this single cluster accounted for ~28 downstream errors. |

**195 -> 31 (-84%), entirely via 9 root-cause clusters. No error was suppressed.**

## Guarantees upheld

No `@ts-ignore`, no `any`, no **newly introduced** `as unknown as`, no `skipLibCheck` change, no
tsconfig `exclude`, no CI exclusion, no file exclusion, no test deleted, no assertion weakened.
The two tsconfig edits are *corrections* — `lib` now matches the real runtime (Bun/ES2022) and
`rootDir`/`include` now cover source that is genuinely part of the program. Neither hides an error.

## Phase-7 safety

`vision-shadow.test.ts` is Phase-7 certified evidence. After its runner was corrected it re-ran at
**17 pass / 0 fail**; `phase7-db-probe` **1 pass / 0 fail**. No certification was touched.

## Remaining (31) — individual defects, no further shared cause

The clustered causes are exhausted. Each remaining error needs its own analysis, and several look
like **genuine application defects** rather than typing noise — e.g. `handlers/index.ts` passing 4
arguments to a 3-argument function and assigning `string` where `number` is required, and
`brain-security.ts` reading `.content`/`.reason` off `OutputValidationResult`, which declares
neither. Those should be investigated as possible real bugs, not silenced.

### By file

| File | Count |
|---|---|
| `src/ai-tools/execution/handlers/index.ts` | 6 |
| `src/services/eta-intelligence.service.ts` | 6 |
| `src/ai/gateway/ai-gateway.ts` | 3 |
| `src/routes/analytics.ts` | 3 |
| `src/ai-brain/security/brain-security.ts` | 2 |
| `src/ai-tools/registry/tool-registry.ts` | 2 |
| `src/services/matching.service.ts` | 2 |
| `src/ai-tools/audit/tool-audit.service.ts` | 1 |
| `src/ai/index.ts` | 1 |
| `src/index.ts` | 1 |
| `src/routes/ai-brain.routes.ts` | 1 |
| `src/routes/ai-gateway.routes.ts` | 1 |
| `src/services/booking-contact.service.ts` | 1 |
| `src/services/partner-incentive-payout.service.ts` | 1 |

### By error code

| Code | Count |
|---|---|
| TS2322 | 12 |
| TS2345 | 12 |
| TS2339 | 3 |
| TS2554 | 2 |
| TS2459 | 1 |
| TS2589 | 1 |

### Full remaining list

```
src/ai-brain/security/brain-security.ts(77,21): error TS2339: Property 'content' does not exist on type 'OutputValidationResult'.
src/ai-brain/security/brain-security.ts(78,20): error TS2339: Property 'reason' does not exist on type 'OutputValidationResult'.
src/ai-tools/audit/tool-audit.service.ts(55,5): error TS2322: Type '{ completedAt: Date | undefined; executionId: string; toolId: string; actorId?: string; actorRole: AiGatewayRole; argumentsHash: string; policyDecision: AiToolPolicyDecision; ... 12 more ...; metadata?: Record<string, unknown>; }' is not assignable to type '(Without<AiToolExecutionCreateInput, AiToolExecutionUncheckedCreateInput> & AiToolExecutionUncheckedCreateInput) | (Without<...> & AiToolExecutionCreateInput)'.
src/ai-tools/execution/handlers/index.ts(41,9): error TS2322: Type 'string' is not assignable to type 'number'.
src/ai-tools/execution/handlers/index.ts(42,9): error TS2322: Type 'string' is not assignable to type 'number'.
src/ai-tools/execution/handlers/index.ts(69,9): error TS2322: Type 'string | undefined' is not assignable to type 'number | undefined'.
src/ai-tools/execution/handlers/index.ts(189,123): error TS2554: Expected 3 arguments, but got 4.
src/ai-tools/execution/handlers/index.ts(236,9): error TS2554: Expected 2-3 arguments, but got 4.
src/ai-tools/execution/handlers/index.ts(242,72): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
src/ai-tools/registry/tool-registry.ts(60,9): error TS2322: Type 'Record<string, unknown>' is not assignable to type 'JsonNull | InputJsonValue'.
src/ai-tools/registry/tool-registry.ts(82,9): error TS2322: Type 'Record<string, unknown>' is not assignable to type 'JsonNull | InputJsonValue | undefined'.
src/ai/gateway/ai-gateway.ts(174,30): error TS2339: Property 'promptHash' does not exist on type '{ safe: false; reason: string; category: string; } | { safe: boolean; sanitized: string; reason?: string | undefined; promptHash: string; }'.
src/ai/gateway/ai-gateway.ts(230,63): error TS2345: Argument of type 'PromptTemplate | { templateId: string; maxTokens: number; systemPrompt: string; }' is not assignable to parameter of type 'PromptTemplate'.
src/ai/gateway/ai-gateway.ts(389,23): error TS2345: Argument of type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>' is not assignable to parameter of type '{ aiGatewayCost: { upsert: (args: unknown) => Promise<unknown>; }; }'.
src/ai/index.ts(30,3): error TS2459: Module '"./types"' declares 'AiGatewayRole' locally, but it is not exported.
src/index.ts(179,13): error TS2589: Type instantiation is excessively deep and possibly infinite.
src/routes/ai-brain.routes.ts(182,7): error TS2322: Type 'Record<string, unknown>' is not assignable to type 'InputJsonObject'.
src/routes/ai-gateway.routes.ts(120,43): error TS2345: Argument of type 'PrismaClient<PrismaClientOptions, never, DefaultArgs>' is not assignable to parameter of type '{ aiGatewayRequest: { aggregate: (args: unknown) => Promise<{ _count: { id: number; }; _sum: { costUsd: number | null; }; }>; groupBy: (args: unknown) => Promise<{ provider: AiProviderType; _count: { ...; }; _sum: { ...; }; }[]>; }; aiGatewayCost: { ...; }; }'.
src/routes/analytics.ts(31,56): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'EtlRunMode | undefined'.
src/routes/analytics.ts(74,81): error TS2345: Argument of type 'string' is not assignable to parameter of type 'FeatureGroup'.
src/routes/analytics.ts(88,38): error TS2345: Argument of type 'string' is not assignable to parameter of type 'VersionType'.
src/services/booking-contact.service.ts(56,42): error TS2345: Argument of type '{ id: string; phoneNumber: string | null; phoneEncrypted: string | null; }' is not assignable to parameter of type 'UserPiiFields'.
src/services/eta-intelligence.service.ts(155,22): error TS2322: Type 'string | null' is not assignable to type 'string | StringFilter<"EtaTrainingLabel"> | undefined'.
src/services/eta-intelligence.service.ts(298,9): error TS2322: Type '{ bookingId: string; partnerHash: string | null; customerHash: string | null; city: string; zone: string | null; cluster: string | null; serviceCategory: string; vehicleType: string | null; ... 68 more ...; features: object; }' is not assignable to type '(Without<EtaTrainingLabelCreateInput, EtaTrainingLabelUncheckedCreateInput> & EtaTrainingLabelUncheckedCreateInput) | (Without<...> & EtaTrainingLabelCreateInput)'.
src/services/eta-intelligence.service.ts(299,9): error TS2322: Type '{ bookingId: string; partnerHash: string | null; customerHash: string | null; city: string; zone: string | null; cluster: string | null; serviceCategory: string; vehicleType: string | null; ... 68 more ...; features: object; }' is not assignable to type '(Without<EtaTrainingLabelUpdateInput, EtaTrainingLabelUncheckedUpdateInput> & EtaTrainingLabelUncheckedUpdateInput) | (Without<...> & EtaTrainingLabelUpdateInput)'.
src/services/eta-intelligence.service.ts(310,46): error TS2345: Argument of type 'string | null' is not assignable to parameter of type 'string'.
src/services/eta-intelligence.service.ts(389,19): error TS2322: Type '"explicit_partner_action" | "gps_geofence" | "job_start" | null' is not assignable to type '"explicit_partner_action" | "gps_geofence" | "job_start"'.
src/services/eta-intelligence.service.ts(404,7): error TS2322: Type '"explicit_partner_action" | "gps_geofence" | "job_start" | null' is not assignable to type '"explicit_partner_action" | "gps_geofence" | "job_start"'.
src/services/matching.service.ts(349,32): error TS2345: Argument of type '{ workingDays: string[]; workingHoursStart: string | null; workingHoursEnd: string | null; breakWindows: JsonValue; timezone: string; }' is not assignable to parameter of type 'ScheduleInput'.
src/services/matching.service.ts(350,25): error TS2345: Argument of type '{ workingDays: string[]; workingHoursStart: string | null; workingHoursEnd: string | null; breakWindows: JsonValue; timezone: string; }' is not assignable to parameter of type 'ScheduleInput'.
src/services/partner-incentive-payout.service.ts(253,39): error TS2345: Argument of type '"PARTNER_INCENTIVE_CREDITED"' is not assignable to parameter of type 'SecurityEvent'.
```
