# PHASE 15 — Production Feature Flags

**This document describes flags that now exist in code.** Before this pass it could not have been
written truthfully: no Phase-15 capability had a flag, so there was nothing to roll out behind.

---

## A. What was actually there

```
scenario-simulation.service    evaluateFlag calls: 0
ai-workflow-draft.service      evaluateFlag calls: 0
cancellation-risk.service      evaluateFlag calls: 0
provider-acceptance.service    evaluateFlag calls: 0

production platform_feature_flags: 2 rows
  AI_BOOKING_RECOVERY              enabled=false  env=dev
  AI_PERSONALIZED_RECOMMENDATIONS  enabled=false  env=dev
```

Two flags scoped to `dev`, neither related to Phase-15, and no Phase-15 code path consulting any
flag. A progressive rollout had no mechanism — the only states were "unreachable" and "on for
everyone".

**This was a release blocker in code, and it is now fixed.**

---

## B. The flags

| Flag | Gates | Default | Safe state | Canary state | Rollback |
|---|---|---|---|---|---|
| `PHASE15_SCENARIO_SIMULATION` | `scenarioSimulationService.simulate` — admin/executive scenario + what-if | **absent → OFF** | `enabled=false` | `enabled=true, rolloutPct=5`, admin cohort only | set `enabled=false` **then call `invalidateFlagCache`** |
| `PHASE15_AI_WORKFLOW_DRAFTING` | `aiWorkflowDraftService.createDraft` — AI-assisted workflow drafting | **absent → OFF** | `enabled=false` | `enabled=true, rolloutPct=5`, named operators only | set `enabled=false` **then call `invalidateFlagCache`** |

### Why these two and not four

`cancellation-risk` and `provider-acceptance` are **evaluation services, not serving paths**. Neither
is exposed to a customer or partner, and neither model was promoted — the deterministic baseline beat
the learned model in both cases. Gating a model that is deliberately not serving would add a control
over nothing and imply the capability is live. They are listed here so the omission is a recorded
decision rather than a gap.

---

## C. Fail-closed, verified

`evaluateFlag` returns `{ enabled: false, reason: "FLAG_MISSING" }` for a key with no row. So on a
production database that has never seen these keys, **both capabilities are off**, and they stay off
until an operator deliberately creates and enables the flag.

Proven by three tests that fail if the gate is removed:

```
scenario simulation refuses while its flag is disabled   -> SIMULATION_DISABLED
workflow drafting refuses while its flag is disabled     -> WORKFLOW_DRAFTING_DISABLED
an absent flag fails closed, not open                    -> reason === "FLAG_MISSING"
```

The gate on drafting sits at **creation**, not at `validate` or `review`. Turning drafting off should
stop new drafts, not strand ones already awaiting a human decision.

---

## D. The cache, and why the runbook must mention it

Flag decisions are cached **30 seconds** in process memory and in Redis
(`CACHE_TTL_SECONDS = 30`, cache key `ff:<env>:<key>`).

**Flipping a flag row in the database is not immediate.** A kill switch flipped without
invalidation takes up to 30 seconds to take effect, and on multiple instances each holds its own
memory cache.

`invalidateFlagCache(key)` exists and publishes on the Redis channel `feature-flags:invalidate` so
every instance drops the entry. **Every flag change in the runbook must be followed by that call.**
The tests now use it, which is why they pass deterministically rather than after a sleep.

---

## E. Environment scoping — the trap that will bite first

`currentEnvironment()` resolves to `APP_ENV || NODE_ENV || "development"`, and `loadFlag` filters
`where: { key, environment }`. **A flag row created with the wrong `environment` value is invisible**
— `evaluateFlag` returns `FLAG_MISSING` and the capability stays off with no error anywhere.

This cost real time during this pass: flags seeded as `environment: "test"` were not found, because
the lookup resolved a different environment string. The fix was to seed using `currentEnvironment()`
itself.

**When creating production flags, set `environment` to exactly what the deployed runtime's
`APP_ENV`/`NODE_ENV` resolves to** — read it from the running instance, do not assume `"production"`.

---

## F. Creating them, when authorized

```sql
-- Create OFF. Never create enabled.
INSERT INTO platform_feature_flags (id, key, description, enabled, rollout_pct, environment, is_kill_switch, created_at, updated_at)
VALUES
  (gen_random_uuid()::text, 'PHASE15_SCENARIO_SIMULATION',
   'Phase-15 scenario simulation and executive what-if', false, 0, '<runtime APP_ENV>', false, now(), now()),
  (gen_random_uuid()::text, 'PHASE15_AI_WORKFLOW_DRAFTING',
   'Phase-15 AI-assisted workflow drafting', false, 0, '<runtime APP_ENV>', false, now(), now());
```

Then, for each: enable one flag at a time, call `invalidateFlagCache`, observe, and only then raise
`rollout_pct`. Never both at once — if something degrades, two simultaneous changes cannot be told
apart.

---

## G. What this does not give you

Feature rollback covers **these two capabilities only**. The migrations underneath them are not
flag-controlled: `ai_workflow_drafts` and `ml_model_versions` exist once applied, and
`enterprise_audit_logs_trace_id_key` is dropped once dropped. Turning a flag off stops the
capability; it does not undo the schema. That distinction is the whole of §E in
`PHASE_15_RELEASE_GATE.md`.
