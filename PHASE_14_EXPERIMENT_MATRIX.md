# PHASE 14 — Experiment Matrix

The platform has **one** experiment mechanism. This matrix describes what it actually is, which is
less than the admin console previously implied.

---

## A. Inventory

| Experiment | Owner | Variants | Assignment | Control | Treatment | Environment | Model/prompt version | Stop switch | Audit | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| `surge_v1` (dynamic pricing) | **`OWNER_UNASSIGNED`** | `control`, `treatment` | sha256(`experiment:customerId`) % 100, split at 50 | `priceMultiplier: 1.0` | `priceMultiplier: 1.0` — **identical** | dev (`homigo_p39`) | none bound | **YES — added this phase** | `EXPERIMENT_CREATED` (added) | **UNREGISTERED → suppressed** |

That is the complete inventory. `platform_experiments` is otherwise empty, and no other experiment
framework exists in the codebase.

---

## B. What was wrong, and what changed

### B1 — There was no stop switch

`assignExperiment` never consulted `platform_experiments`. Pausing an experiment, or deleting the
row entirely, changed nothing: every caller was still bucketed and every exposure still counted.
A control you cannot turn off is not a control.

**Now:** status is read on every assignment. Anything other than `running` returns `control` for
everyone and records **no** exposure — a stopped experiment stops producing data as well as
stopping acting.

**Verified, 200 callers per state:**

| State | Active | Variant distribution |
|---|---|---|
| Unregistered | **0 / 200** | 200 control |
| `running` | **200 / 200** | 107 treatment / 93 control |
| `paused` | **0 / 200** | 200 control |

No cached assignment survived the stop, because there is no assignment cache — bucketing is
recomputed from the hash each call, which is what makes the stop immediate.

### B2 — Creation was unaudited

`updateFlag`, twenty lines above in the same service, recorded `PLATFORM_FLAG_UPDATED` through
`AuditLogService`. `createExperiment` wrote a row and returned. So "who started the experiment that
was running in March" had no answer — on the one governance object whose entire purpose is to
change production behaviour for a subset of real users.

**Now:** `EXPERIMENT_CREATED`, with `activatedOnCreate` flagged separately, because creating a
draft and creating something already `running` are materially different acts.

### B3 — The inventory contained a fabricated running experiment

`listExperiments()` injected a code-defined experiment with no registry row into the admin list as
`status: "running"`. It read exactly like a governed experiment while having no owner, no stored
variants, and — before B1 — no way to turn it off.

**Now:** listed as `status: "unregistered"`, `registered: false`, `differentiated: false`, with its
suppression stated in the description. Still listed, because the code path genuinely exists and
hiding it would be the opposite error.

### B4 — The arms are identical, and the experiment measures nothing

```ts
const priceMultiplier = variant === "treatment" ? 1.0 : 1.0;
// comment claimed: "treatment applies the dynamic multiplier; control caps at 1.0"
```

Both arms return the same number. On top of that, `recordConversion` — the only function that would
record an outcome — **is never called from production code**, so
`pricing_experiment_conversion_total` is permanently 0.

So the experiment buckets users, counts exposure, applies no difference, and can observe no
outcome. Any gap between the arms is noise.

**Deliberately not "fixed."** Making the treatment arm move prices would be inventing pricing
policy — a business decision, and not one to smuggle in behind a governance change. The state is
surfaced instead: `differentiated: false` on every assignment, and a test that asserts it.

**`HUMAN_DECISION_REQUIRED`:** what treatment should do, and where `recordConversion` should be
called from.

---

## C. Assignment properties

| Property | Requirement | Result |
|---|---|---|
| Deterministic | §31 — same entity, same arm | **PASS** — 20 repeats for one customer produced 1 distinct variant |
| Sticky across restarts | §31 | **PASS** — stateless hash, no assignment table to lose |
| Balanced | — | 107/200 treatment (53.5%) at n=200 |
| Single randomisation engine | §31 — do not build a second | **PASS** — no second engine added |
| Recomputed per call | §87 — no stale cache defeats the stop | **PASS** |

---

## D. Safety

| Requirement | Status | Evidence |
|---|---|---|
| §32 — cannot bypass RBAC | **PASS** | Assignment returns a variant label; it grants no permission and touches no authorization path |
| §32 — cannot bypass finance/fraud controls | **PASS** | The only output is a `priceMultiplier` that no checkout path consumes; pricing is recommended, not applied |
| §32 — high-risk actions not exposed to assignment | **PASS** | No high-risk tool or workflow reads an experiment variant |
| §33 — does not contaminate training data | **PASS** | Variant is not a feature in any `MlFeatureStaging` or model input |
| §33 — does not contaminate billing | **PASS** | Both arms are 1.0, and nothing consumes the value |
| §33 — does not contaminate customer state | **PASS** | Assignment writes nothing |
| §34 — no manufactured significance | **PASS** | Exposure counted; conversion permanently 0; `differentiated: false` reported |
| §75 — flags and experiments cannot conflict | **PASS** | `PlatformFeatureFlag` and `PlatformExperiment` are separate tables read by separate code; no shared key space |
| §76 — environment isolation | **PASS** | Experiment rows live in the database; each environment has its own |

**On §34.** The honest reading of this experiment is that it cannot currently produce a
statistically meaningful result — not because the sample is small, but because there is no
treatment and no outcome measurement. Reporting an "exposure count" as evidence of a running
experiment was the exact failure mode B3 fixed.

---

## E. Stop-switch mechanics

| Layer | Mechanism | Verified |
|---|---|---|
| Registry | `platform_experiments.status` | Read on every call |
| Unregistered | Treated as **stopped**, never running-by-default | 0/200 active |
| Paused | Immediate reversion to control | 0/200 active |
| Cache | None exists | Recomputed per call |
| Feature flag kill switch | `PlatformFeatureFlag.isKillSwitch` (pre-existing, separate) | Not modified |

---

## F. Outstanding

| # | Item | Type |
|---|---|---|
| 1 | What the `treatment` arm should actually do | **HUMAN_DECISION_REQUIRED** |
| 2 | Where `recordConversion` should be called from | **HUMAN_DECISION_REQUIRED** |
| 3 | An owner for `surge_v1` | **HUMAN_DECISION_REQUIRED** — `OWNER_UNASSIGNED`; naming someone would put them on the hook for something they never accepted |
| 4 | Registering `surge_v1` so it can run at all | **HUMAN_DECISION_REQUIRED** — it is suppressed until someone does |
| 5 | Hypothesis, eligibility rules, exclusions, start/end | **NOT MODELLED** — `PlatformExperiment` has `key`, `description`, `status`, `variants`, `updatedBy` and nothing else. Extending the schema for fields no experiment uses would be speculative |
