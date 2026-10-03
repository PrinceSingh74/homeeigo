# PHASE 15 — Partner Integration

§S asked the same feasibility question for the Partner App. The answer differs from the customer
case in one important way: here the data **does** support a capability — and the evaluation says the
platform already has the right implementation.

---

## A. Candidates assessed

### A1. Acceptance guidance — **DATA EXISTS, AND THE PLATFORM ALREADY HAS THE ANSWER**

This is the one candidate with a real label:

```
assignment_attempts : 3,164 offers · 54 providers · 88 days
ACCEPTED   236      REJECTED 7      TIMEOUT 2,904      SENT 17 (in flight)
```

A model was built and evaluated properly:

```
candidate       AUC 0.9528   Brier 0.0527
prior-rate rule AUC 0.9642   Brier 0.0425     <-- the BASELINE WINS
materiality     margin -0.0114 (-0.7 SE)
```

**The learned model loses to the trivial rule.** Only **16 of 54 providers have ever accepted**, and
one accounts for **176 of the 236 acceptances**. Acceptance is provider identity, and a per-provider
historical rate captures it directly.

**And that rule already exists.** `providers.acceptanceRate` is maintained by
`assignment-engine.refreshProviderAcceptanceRate` on a 30-day rolling window, and is already
surfaced to partner context via `ai-brain/context/collectors/partner-context.ts`.

So the correct Phase-15 outcome here is **not** to ship a model. It is that the evaluation
**validated an existing deterministic control** — and, in doing so, found a defect in it.

### A2. The defect that validation found — **FIXED**

```ts
const rate = total > 0 ? Math.round((accepted / total) * 10000) / 100 : 100;
```

An empty 30-day window wrote **100**: a provider who went quiet for a month was re-scored as a
**perfect acceptor** on their next dispatch. Against a platform-wide rate of 7.5%, 100 is the most
misleading value the column can hold — and it is read by the admin provider list, ETA intelligence
and partner context.

**Fixed:** no evidence in the window now writes nothing, leaving the last real measurement in place.
Verified by reintroducing the fabrication and watching the guard test fail.

**Two things I got wrong while investigating**, both of which narrowed the severity: the column
default is **0**, not 100 (so new providers are not inflated), and `acceptanceRate` is **not** used
in dispatch ranking (so this is a reporting defect, not a routing one). Recorded because the
original framing would have overstated it.

### A3. Workload / availability prediction — **NOT VIABLE**

No labelled outcome exists for "was this partner overloaded". The platform records dispatches and
acceptances, not capacity strain, and inferring strain from timeouts would confound "busy" with
"not looking at the app".

### A4. ETA guidance — **ALREADY EXISTS, AND IS BLOCKED UPSTREAM**

`eta-intelligence.service` already serves partners. Its ML candidate remains blocked at **0 of 50**
required real labels from Phase 12, with 75 quarantined rows. Unchanged by this phase.

### A5. Partner intelligence engine — **NOT DUPLICATED**

§S forbids duplicating it, and nothing here does. Phase 15 read `assignment_attempts` for evaluation
and touched one function in the assignment engine. No parallel partner-intelligence path was
created.

---

## B. What shipped to the partner app

**No new partner-facing surface.** What changed is that a value partners' ranking context already
consumed stopped occasionally being fabricated.

| Change | Partner-visible effect |
|---|---|
| `acceptanceRate` no longer writes 100 on an empty window | A dormant provider's displayed rate stays at its last real measurement instead of resetting to perfect |
| Update failures now logged | A stale rate presented as current becomes diagnosable |

That is a correctness fix to an existing surface, and describing it as "partner integration" would
overstate it.

---

## C. The limitation this does not close

`providers.acceptance_rate` is `NOT NULL DEFAULT 0`. It **cannot express "unknown"** — 0 reads as
"always refuses", 100 as "always accepts", and a provider with no history is neither. Writing 0
instead of 100 would be the same fabrication pointing the other way.

Leaving the previous value is the honest action available without a schema change. A nullable column
plus every consumer taught to render UNKNOWN is a migration with a wide blast radius across admin
display, ETA intelligence and partner context — recorded as a follow-up rather than made as a side
effect of a capability phase.

---

## D. Verdict

| Capability | State |
|---|---|
| Acceptance guidance | **Deterministic predictor validated and corrected** — no model shipped, correctly |
| Workload prediction | `BLOCKED_BY_DATA` — no capacity-strain label exists |
| ETA guidance | Pre-existing; still blocked at 0/50 labels (Phase 12) |
| Partner intelligence engine | Untouched, not duplicated |

**The honest summary:** Phase 15's partner contribution is a measured negative result plus the
defect that measuring it uncovered. The evaluation earned its keep by validating the deterministic
control the platform already had — and by finding it was quietly lying about dormant providers.
