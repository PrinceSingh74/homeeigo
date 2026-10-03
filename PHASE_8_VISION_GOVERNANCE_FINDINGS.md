# PHASE 8 — P0-2: Vision Governance Findings

**Mode: investigation only.** No code, schema, or certification changes were made while producing
this document. No production behavior was modified. The one runtime probe performed (calling
`visionObservationMode()`) is a pure, side-effect-free read of already-computed config state — it
does not submit an image, call Gemini, or write to the database.

**Traced:** `src/routes/vision.routes.ts` (full, 230 lines), `src/services/vision-intelligence.service.ts`
(full, 369 lines), `src/ai/config.ts` (`aiConfig.gemini`, `aiConfig.dryRun`), `.env` / `.env.local`
(real runtime values, not assumed), `scripts/final-certify-vision.ts` (the certification script run
in Phase 7), `src/automation/registry/certification.ts` (`certifyAutomation`/`getCertification`),
`src/automation/registry/definitions/index.ts` (full workflow registry — confirms no
`vision_intelligence` workflow exists), `src/automation/engine/step-executor.ts` (confirmed, by
contrast, how `executionMode === "SHADOW"` genuinely IS enforced for real workflow automations),
`src/services/feature-flag.service.ts` (`PHASE7_FLAGS`, confirms `AI_VISION` is declared),
`apps/admin-panel/src/app/(console)/vision/page.tsx` (admin controls — status + purge, per the
Phase 8 discovery pass).

---

## The central fact, proven not assumed

I ran `visionObservationMode()` directly against this session's real environment (`.env` +
`.env.local`, the same config the running backend uses):

```
visionObservationMode(): REAL_PROVIDER
aiConfig.gemini.apiKey present: true
aiConfig.dryRun: false
VISION_FORCE_FALLBACK: undefined
```

**A real `GEMINI_API_KEY` is configured in `.env.local` right now.** Vision is not dormant, not
blocked, and not limited to a "shadow" no-op in this environment — any authenticated user calling
`POST /api/vision/images/submit` then `POST /api/vision/images/:id/analyze` gets a **real Gemini
Vision API call** on their real uploaded photo today, in this running dev backend. This matches the
Phase 7 closure record ("Real Gemini provider proven end-to-end") — it is not new behavior, but it
is the necessary starting fact for everything below: the governance question is not hypothetical.

---

## Answers to the 7 required questions

### 1. What exactly does the Vision certification authorize?

The `AutomationCertification` row (`automationId: "vision_intelligence"`, `workflowVersion: 1`,
`approvedExecutionMode: "SHADOW"`, real admin ID, a specific approval reason, and a
`knownLimitations` field that explicitly states *"LIVE explicitly not authorized by this
certification"*) is a **human sign-off / audit record**. It was created through the same hardened
path (`certifyAutomation()`) used for genuine workflow automations — audit-log-write-before-
certification-row, real admin resolved from the `users` table, unique per version, voided-not-
deleted. As a record of *approval*, it is real and trustworthy: a named admin did review and approve
specific, itemized claims (Gemini integration verified, image validation verified, advisory-only
verified, security tested, retention verified).

### 2. What actually enforces that authorization?

**Nothing, mechanically.** `vision.routes.ts` and `vision-intelligence.service.ts` were read in full
— neither file imports `getCertification`, queries the `AutomationCertification` table, or checks
`approvedExecutionMode` in any form. The only "mode" concept that exists in the real code path is
`visionObservationMode()`, and it answers a different question entirely: *"is a Gemini credential
configured"* (→ `REAL_PROVIDER` or `FALLBACK`), not *"is this feature certified for SHADOW vs LIVE."*
What genuinely does constrain the feature: `requireAuth()` (any authenticated user), an ownership
check on every read/analyze (`image.ownerId !== requesterId` → 403, real IDOR protection), image
validation (magic-byte checked, not just declared MIME), and the *advisory-only* property — which is
structural (no code path from Vision into any money- or state-mutating service), not flag-gated.

### 3. Does the feature flag gate runtime?

**No.** `AI_VISION` is declared in `PHASE7_FLAGS` (`feature-flag.service.ts`) but a full-text search
of both `vision.routes.ts` and `vision-intelligence.service.ts` shows zero references to it, and no
import of the feature-flag service at all. This independently confirms the Phase 8 discovery
agent's finding via direct source inspection rather than a grep summary.

### 4. Can the feature run while certification is void/missing?

**Yes, unconditionally.** If an admin called `voidCertification("vision_intelligence", 1)` this
instant, `/api/vision/*` would behave identically — the certification row is never read at request
time. The certification is a governance artifact sitting *beside* the running feature, not a gate
*in front of* it.

### 5. Does LIVE/SHADOW have any actual runtime effect (for Vision specifically)?

**No — and this is the core finding.** For contrast, I confirmed how SHADOW genuinely IS enforced
for a real workflow automation: `step-executor.ts` checks `instance.executionMode === "SHADOW"` at
multiple points (lines ~421, ~463, ~541) and, when true, **skips the real customer-facing action**
(a notification send, a step that would otherwise fire) and records `ShadowEvidence` instead — real,
code-level interception. `WorkflowInstance.executionMode` is set from the workflow's certified state
at instantiation. Vision has no equivalent. Its only real behavioral axis is `REAL_PROVIDER` vs
`FALLBACK`, which is entirely orthogonal to SHADOW/LIVE and is driven purely by whether a Gemini
credential happens to be configured in the environment — not by anyone's certification decision.

### 6. Is Vision intentionally a non-workflow capability?

**Yes, by all available evidence.** `src/automation/registry/definitions/index.ts` was read in full
(the complete workflow registry) — no `vision_intelligence` (or similarly-named) `WorkflowDefinition`
exists anywhere in it, and none of the 13 registered workflows reference Vision. Architecturally,
Vision is a direct, synchronous request/response API (`POST submit` → `POST analyze` → return result
to the SAME user, in the SAME HTTP request/response cycle) — fundamentally different in shape from
an event-triggered background automation like `follow_up` (fires on `booking.completed`, runs hours
later, with no user action in the loop). The code itself (extensive, deliberate prose comments
throughout `vision-intelligence.service.ts` explaining *why* each design choice was made — e.g. why
a fallback never guesses, why `PROVIDER_ERROR` is recorded as `REAL_PROVIDER` not `FALLBACK`) reads
as a considered design, not an oversight or an unfinished migration into the workflow engine.

### 7. If yes, should it use a capability-certification model instead of WorkflowCertification semantics?

This is the actual decision point, and it is a real one — not a technicality. Two legitimate paths:

**Option A — retrofit real enforcement.** Add a genuine runtime check so "SHADOW" means something
concrete for Vision: e.g., wire `AI_VISION` (or the certification's `approvedExecutionMode`) into
`visionObservationMode()` or the route layer, so an admin can actually flip a switch that changes
behavior (today, the only real kill switches are `VISION_FORCE_FALLBACK=true` or removing/rotating
`GEMINI_API_KEY` — the latter breaks every Gemini-based AI feature, not just Vision, since the
credential is shared with the AI Gateway). This makes the certification's field truthful again, at
the cost of adding a new gate to an already-working, already-certified feature.

**Option B — reclassify.** Acknowledge that Vision's real safety model is already complete and
different in kind from a workflow's: (i) structural advisory-only (can't touch money/state — true by
absence of code, not by flag), (ii) credential-driven REAL_PROVIDER/FALLBACK (an operational
concern, not a governance one), (iii) auth + ownership (real access control). Under this view,
`AutomationCertification`'s `approvedExecutionMode: SHADOW` field is simply the wrong shape for what
was actually being approved — a one-time, itemized *human sign-off that this capability is safe to
run*, not an execution-mode toggle. The honest fix would be a differently-shaped record (or a
repurposed field) that doesn't imply an enforcement mechanism that was never built for this kind of
capability.

**I am not choosing between these.** Both are legitimate, and the choice changes the shape of an
already-certified capability — squarely a product/governance decision, not a P0 hotfix call. Per the
Phase 7 freeze rule and this batch's explicit instruction, I am not voiding, altering, or "fixing"
the existing certification. It stands exactly as it was: a real, audited admin approval, honestly
described in its own `knownLimitations` text, that happens not to be mechanically enforced.

---

## What this does NOT mean

This is not evidence that Vision is unsafe or that the Phase 7 certification was wrongly granted.
Every specific claim the certification made — real Gemini integration, image validation, ownership
isolation, advisory-only behavior, retention controls — was independently re-verified as true in
this investigation. What's missing is narrower and more specific: **the SHADOW/LIVE label on the
certification row implies a kind of enforcement (the workflow engine's) that doesn't exist for this
kind of capability (a direct API, not a workflow).** The feature has been behaving exactly as
described since Phase 7; it just isn't behaving that way *because* of the certification.

## Recommendation for the work manifest

`HUMAN_DECISION_REQUIRED`: Option A (retrofit enforcement) vs Option B (reclassify the certification
model for non-workflow capabilities). Whichever is chosen, implementing it counts as "a Phase-8
change that affects a Phase-7 signed capability" under this project's explicit rule — it must stop,
have its impact identified, and go through re-certification / a new capability-approval record
before being considered complete. Recorded in `PHASE_8_WORK_MANIFEST.md` as P0-2 with this document
as its evidence trail.
