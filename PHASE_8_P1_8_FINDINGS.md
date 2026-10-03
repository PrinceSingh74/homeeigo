# PHASE 8 — P1-8: AI Prompt Architecture Duplication — Findings

**Mode: investigation only.** No code, schema, or data changes were made. One read-only runtime
probe was run (a script comparing current code's `BUILTIN_TEMPLATES` against real DB rows) — no
writes, no prompt behavior changed.

---

## Architecture A — `AiPromptTemplate` (Phase 3, code-first)

**Schema** (`prisma/schema.prisma:4404`): single flat table. `templateId` (unique), `name`,
`category`, `actorRole` (enum), `systemPrompt`, `userTemplate?`, `maxTokens`, `version: Int`
(a plain counter field — never actually incremented anywhere in the code; there is no version
*history*, only ever one row per `templateId`), `isActive: Boolean`, `metadata: Json?`.

**Source**: exactly one file, `src/ai/templates/prompt-templates.ts` (202 lines). Defines 11
hardcoded prompts in a `BUILTIN_TEMPLATES` array (the actual prompt text lives in source code, not
the DB) and 4 functions:
- `seedPromptTemplates()` — upserts all 11 builtins into `ai_prompt_templates` on every boot,
  **always overwriting** `name`/`systemPrompt`/`maxTokens`/`isActive` on the `update` branch.
- `getTemplate(templateId, role)` — the resolver: DB row (if `isActive`) → else the matching
  in-memory builtin by id → else the first builtin for the actor's role → else
  `customer.support.v1`. **The code array is the true bedrock fallback beneath even the DB table.**
- `listBuiltinTemplates()`, `renderUserPrompt()`.

**API routes**: **none.** Zero admin endpoints, zero admin UI. The only way to change a prompt here
is to edit `BUILTIN_TEMPLATES` in source and redeploy (the DB row will be overwritten to match on
next boot regardless of any manual DB edit).

**Callers** (exactly 2, both real, both intentional): `ai/gateway/ai-gateway.ts` (always, for a
baseline `legacyTemplate`) and `ai-brain/prompts/prompt-intelligence.ts` (as Architecture B's own
fallback — see below).

**Versioning**: none. **Activation**: a single boolean per template, forced `true` on every boot.
**Caching**: none (direct `findUnique` each call). **Audit**: none — no `createdBy`/`approvedBy`,
no history of what changed or when beyond `updatedAt`. **Security**: not independently
route-exposed, so no separate RBAC surface — inherits whatever calls it.

**Tests**: `src/__tests__/ai-gateway.test.ts` — covers `listBuiltinTemplates()` only (category
coverage, count). No test exercises `getTemplate()`'s DB-vs-fallback resolution logic.

---

## Architecture B — `AiPromptRegistry` + `AiPromptVersion` (Phase 4, ai-brain governance)

**Schema** (`prisma/schema.prisma:4481` / `:4500`): two related tables. `AiPromptRegistry`
(`promptId` unique, `name`, `category`, `owner`, `description`, `approvalStatus` enum
`DRAFT|PENDING|APPROVED|REJECTED|DEPRECATED`, `createdBy`/`updatedBy`) has many
`AiPromptVersion` (`registryId` FK, `version: Int`, `systemPrompt`, `userTemplate?`,
`variables`/`inputs`/`outputs` JSON, `temperature`, `maxTokens`, `safetyLevel` enum
`LOW|MEDIUM|HIGH|CRITICAL`, `fallbackPromptId?`, `diffFromPrevious?`, `experimentTag?`,
`isActive`/`isDeprecated` booleans, `approvedBy?`/`approvedAt?`, `createdBy?`). Real, unique
`(registryId, version)` constraint — genuine version history is structurally possible here, unlike
Architecture A.

**Source**: 3 files. `ai-brain/prompts/prompt-registry.ts` (seed + CRUD reads: `seedPromptRegistry`,
`listPromptRegistry`, `getPromptById`, `createPromptRegistry`). `ai-brain/prompts/prompt-versioning.ts`
(the governance engine: `createPromptVersion` with a real line-diff computed against the previous
version, `approvePromptVersion`, `rejectPromptVersion`, `rollbackPromptVersion`,
`deprecatePromptVersion`, `listPromptVersions`, `getActivePromptVersion`, `resolvePromptForRequest`
— actor-bucketed A/B experiment routing via a real hash — and `resolvePromptWithFallback`, which
walks a `fallbackPromptId` chain up to depth 3). `ai-brain/prompts/prompt-intelligence.ts`
(`composePrompt` — the actual integration point with the AI Gateway, described below).

**API routes**: full REST surface at `/api/ai/prompts` and `/api/ai/prompt-versions`
(`routes/ai-brain.routes.ts`) — list, get, create, create-version, approve, reject, rollback,
deprecate. All gated by `requireAdmin(role)`, a **simple `role === "ADMIN"` check**, not the
granular `AdminResource`/`AdminAction` RBAC model used elsewhere in this codebase — any admin,
regardless of their specific `AdminRoleType` (`SUPPORT_ADMIN`, `FINANCE_ADMIN`, etc.), can approve
or roll back a production AI prompt. No scoped "prompt admin" permission exists.

**Admin UI**: `apps/admin-panel/src/app/(console)/ai-brain/prompts/page.tsx` — **read-only**. Calls
only `GET /prompts`; renders a card grid (id, name, category, owner, active version + token limit).
No create/approve/reject/rollback/deprecate UI exists despite the backend fully supporting all of
them — those actions are only reachable via direct API calls today.

**Callers of the runtime-resolution functions** (`getActivePromptVersion`,
`resolvePromptForRequest`, `resolvePromptWithFallback`): **exactly one**, `composePrompt()` in
`prompt-intelligence.ts`. Nothing else in the codebase calls them.

**Tests**: none. Zero test coverage for any function in any of these 3 files.

---

## The real integration point — which one is actually authoritative

Traced `ai/gateway/ai-gateway.ts` end to end (the only place either architecture's runtime resolver
is invoked from a real customer/partner/admin-facing request):

```
enterpriseCtx = aiBrainConfig.enabled ? await buildEnterpriseContext(...) : null
composed = (aiBrainConfig.enabled && enterpriseCtx) ? await composePrompt({ promptId: input.templateId, ... }) : null
legacyTemplate = await getTemplate(input.templateId, actor.actorRole)   // ALWAYS called
template = composed ? { ...composed, maxTokens: legacyTemplate.maxTokens } : legacyTemplate
```

Inside `composePrompt()`:

```
if (input.promptId) {
  const registryVersion = await resolvePromptWithFallback(input.promptId, actorId)
  if (registryVersion && registryVersion.approvalStatus === "APPROVED") {
    // Architecture B wins
  } else {
    const fallback = await getTemplate(input.promptId, input.role)   // Architecture A
  }
}
```

**`aiBrainConfig.enabled` defaults to `true`** (`process.env.AI_BRAIN_ENABLED !== "false"`) and is
**not overridden** in this environment's `.env`/`.env.local` (confirmed directly, not assumed).
`enterpriseCtx` is built unconditionally whenever ai-brain is enabled.

**Conclusion: Architecture B is genuinely authoritative in this running system today** — every
real AI Gateway call resolves its prompt from `AiPromptRegistry`/`AiPromptVersion` first, and only
falls through to Architecture A when ai-brain is disabled, the enterprise context couldn't be
built, or the registry has no `APPROVED` entry for that `promptId`. This is not dead or aspirational
code — it is the live, primary path, and the "supersede without a code change" comment in both
`prompt-templates.ts` and `routes/ai.ts` accurately describes real, working behavior.

---

## Real database state (this dev environment, verified, not assumed)

11 rows in `ai_prompt_templates`, 11 in `ai_prompt_registry`, 11 in `ai_prompt_versions` — **one
row/version per builtin prompt in every table**, confirming genuine ongoing dual-write: both
`seedPromptTemplates()` and `seedPromptRegistry()` are called unconditionally on every boot
(`src/index.ts:318-319`, both fire-and-forget with `.catch(() => undefined)` — a seed failure would
be entirely silent, a secondary finding).

Every registry entry has exactly **1 version** — `createPromptVersion()` (the version-bump API) has
never been called in this environment's history. One entry, `customer.support.v1`, shows
`approvedBy` set to a real admin user ID (not `"system"`) — genuine evidence the human
approve/reject workflow has been exercised for real at least once, not purely theoretical.

**Drift check**: compared every builtin's current source-code text against both tables' stored
content — **zero drift found today**. All 11 match in both tables right now.

---

## The real structural bug — a version-drift trap, proven by code, not yet manifested in data

`seedPromptRegistry()`'s version-creation step:

```js
const existingVersion = await prisma.aiPromptVersion.findFirst({ where: { registryId, version: 1 } });
if (!existingVersion) {
  await prisma.aiPromptVersion.create({ data: { ..., systemPrompt: tpl.systemPrompt, ... } });
}
```

This only ever **creates** version 1 if it's missing — it never **updates** an existing version 1's
content. Compare `seedPromptTemplates()` (Architecture A), whose `update` branch unconditionally
overwrites `systemPrompt` every boot.

**Consequence**: if a developer edits a builtin prompt's text in `BUILTIN_TEMPLATES` and deploys,
Architecture A's DB row picks up the change immediately on restart (as designed) — but Architecture
B's registry version 1, **the row that is actually authoritative per the trace above**, keeps
serving the stale text indefinitely, with zero error, warning, or log line anywhere indicating the
code change was silently ineffective. The only way to make an edited builtin prompt actually take
effect in production is to separately call the admin-only `createPromptVersion` API — a step
nothing in the deploy process prompts anyone to remember, and the read-only admin UI provides no
way to do at all. This hasn't happened yet in this dev environment (0 drift, confirmed above)
purely because nobody has edited a builtin prompt's text since the registry was first seeded — the
mechanism is real and latent, not hypothetical.

---

## Answers to the 10 required questions

1. **Which architecture is actually authoritative?** Architecture B (`AiPromptRegistry`/
   `AiPromptVersion`), confirmed by tracing the real `composePrompt()` resolution order under this
   environment's actual config.
2. **Which one is actively used?** Both, for different roles: B is the primary resolver for every
   real AI Gateway call; A is B's own fallback (when ai-brain is disabled, or a registry entry is
   missing/not-approved) *and* B's seed source *and* the code-level bedrock beneath its own DB
   table.
3. **Which one is partially used?** Architecture B's richer capabilities are partially used —
   versioning/diff/rollback/experiment-tag A/B routing are fully built and wired but have never
   been exercised beyond the initial seed (every registry entry is stuck at version 1); the admin
   UI only exposes read access, not the create/approve/rollback/reject/deprecate actions the
   backend supports.
4. **Are both writing production data?** Yes — confirmed via real row counts and boot-time seed
   calls; this happens on every single server start, not a one-time historical artifact.
5. **Is there data duplication?** Yes — the same 11 prompts' content is stored redundantly across
   `ai_prompt_templates` and `ai_prompt_versions` in this environment.
6. **Is there version drift?** None *currently observed* in this dev environment (verified, not
   assumed) — but a real, proven-by-code mechanism exists that will silently cause drift the next
   time anyone edits a builtin prompt's text without also remembering to call the separate,
   admin-only, UI-unsupported `createPromptVersion` API.
7. **Can deleting/merging one break existing prompts?** Neither deletion breaks the AI Gateway's
   ability to *function* — Architecture A's in-memory `BUILTIN_TEMPLATES` array is a bedrock
   fallback beneath even its own DB table, and Architecture B falls through to Architecture A when
   empty. But deleting Architecture B would permanently lose all approval/audit history (including
   the one real human-approved entry found) and the versioning/rollback/experiment machinery;
   deleting Architecture A's DB table would remove the DB-level hot-patch lever for the fallback
   path and for any `promptId` not yet in the registry.
8. **Does either architecture support rollback?** Only Architecture B (`rollbackPromptVersion`) —
   real, implemented, route-exposed, never yet exercised in this environment's history. Architecture
   A has no version concept to roll back to.
9. **Does either architecture participate in audit/governance?** Only Architecture B in any real
   sense — `approvalStatus`, `approvedBy`/`approvedAt`, `createdBy`, `diffFromPrevious`, and one
   confirmed real human-approval event. Architecture A has no approval concept; every row is
   auto-`isActive: true` on every boot regardless of who wrote it.
10. **Which architecture should become the single source of truth?** Architecture B is the
    evidence-backed answer — it is already the real runtime authority, has the governance model
    this project's whole certification/audit discipline is built around, and has real (if sparse)
    human-approval history. Architecture A's *code-defined content* (`BUILTIN_TEMPLATES`) should be
    kept as the bedrock fallback (it already serves that role safely) — what's genuinely redundant
    is Architecture A's **database table**, which does nothing `BUILTIN_TEMPLATES` doesn't already
    do, since `getTemplate()` falls back to the in-memory array whenever the DB row is absent.

---

## Risks

- **Version-drift trap** (above) — the most concrete, highest-priority finding. A future code
  change to a builtin prompt will silently fail to take effect in production until someone
  separately remembers to call an admin-only, UI-unsupported API.
- **Broad admin access** — any `ADMIN`-role user can approve/rollback a production prompt; no
  scoped RBAC permission exists for this specific, trust-and-safety-relevant capability.
- **Silent seed failures** — both `seedPromptTemplates()` and `seedPromptRegistry()` are
  fire-and-forget with `.catch(() => undefined)` at boot; a failure in either is invisible.
- **Untested governance path** — zero test coverage for any of Architecture B's approval/version/
  rollback/experiment logic, the more complex and now-confirmed-authoritative of the two systems.

## Duplication

Confirmed real and ongoing (not historical): 11 prompts × 2 tables, reseeded identically on every
boot. Architecture A's DB table is the redundant one — its content is already fully present, and
more reliably kept fresh, in the `BUILTIN_TEMPLATES` code array that both architectures already
depend on as their ultimate fallback.

## Migration impact

Removing Architecture A's DB table (not its code array) would require: (a) confirming no other
undiscovered caller reads `AiPromptTemplate` directly (this investigation found none beyond
`getTemplate()` itself), (b) changing `getTemplate()` to skip the DB lookup and read directly from
`BUILTIN_TEMPLATES`, (c) a migration dropping `ai_prompt_templates` — additive-safe to defer,
destructive to execute, and explicitly out of scope for this investigation to decide or perform.
Removing or merging Architecture B is not recommended by any evidence found here — it is the
correctly-designed, already-authoritative system; its gaps (untested, drift-prone seed, no admin UI
for its own workflow, broad RBAC) are gaps to close, not reasons to remove it.

## Security impact

The broad-admin-access gap (finding above) is the one concrete security-relevant item — worth
folding into the existing P1-4 admin-RBAC-UI work already in the manifest rather than treated as
fully separate, since both are instances of "admin panel actions aren't scoped by `AdminRoleType`."

## Rollback strategy

Architecture B already has one, real and implemented (`rollbackPromptVersion`), just never
exercised. No rollback concept applies to Architecture A (single mutable row, no history).

---

## Human decisions required

`HUMAN_DECISION_REQUIRED` — none of the following were decided or acted on:
1. Whether to remove Architecture A's DB table (keeping its code array as the fallback) — the
   evidence-backed recommendation above, but a real schema/behavior change requiring approval.
2. Whether/how to close the version-drift trap — options include: making the registry seed refresh
   version 1's content when it's still `approvedBy: "system"` (i.e., never manually approved) while
   leaving any human-approved version untouched; building the missing "create version" admin UI so
   the manual step is actually discoverable; or documenting the required manual step prominently.
   Each has different governance implications and is not a decision to make unilaterally.
3. Whether to scope prompt approval/rollback to a specific admin permission rather than blanket
   `ADMIN` — likely bundled with the existing P1-4 admin-RBAC-UI item.

## Safe migration sequence (if/when authorized — not started)

1. Add test coverage for Architecture B's resolution/approval/rollback logic first (currently zero)
   — a prerequisite for safely changing anything here, not an optional nice-to-have.
2. Fix the version-drift trap (per whichever option is chosen in decision #2 above) and verify with
   a real test that an edited builtin prompt's text now actually reaches the registry without
   overwriting a human-approved version.
3. Only after 1–2 are done and stable: consider removing Architecture A's `AiPromptTemplate` DB
   table, changing `getTemplate()` to read `BUILTIN_TEMPLATES` directly, and dropping the table via
   an additive-safe migration (no data loss risk, since nothing reads it except the fallback that's
   being redirected to the code array it already mirrors).
4. Build the missing admin UI actions (create/approve/reject/rollback/deprecate) for Architecture
   B, or explicitly decide they're intentionally API-only.
