# PHASE 15 — Customer Integration

§R asked for a complete feasibility study of the lowest-risk Phase-15 capabilities that could safely
benefit customers. This is that study, and its conclusion is that **nothing should ship to the
customer app in this phase**.

That is a finding, not an omission, and each candidate below was assessed against real evidence
rather than dismissed.

---

## A. Candidates assessed

### A1. Personalised recommendations — **NOT VIABLE**

| Evidence | Value |
|---|---|
| Customers who have booked | 147 |
| **Customers with ≥2 bookings** | **30** |
| Customers with ≥5 bookings | 10 |
| Explicit ratings | 22 |

**117 of 147 customers (80%) have booked exactly once.** Personalisation needs repeat preference and
four fifths of the population has none. What could ship is a popularity ranker labelled
"recommended for you" — which is a claim the data does not support, made directly to a customer.

§R forbids exposing experimental ML. This would be worse: exposing a non-model as if it were one.

### A2. Cancellation-risk-informed messaging — **NOT VIABLE, and the reason matters**

The model exists and was evaluated: AUC 0.7085 against a baseline of 0.6945 — **0.24 standard
errors**, indistinguishable from the trivial rule.

Suppose it shipped as a nudge ("customers like you often cancel — confirm your booking?"). At this
discrimination the message lands on roughly as many customers who would have completed as who would
have cancelled. It would be a **behavioural intervention on a coin flip**, aimed at people, and its
apparent effectiveness would be unmeasurable because nothing captures whether the nudge changed
anything.

**A model that must not be promoted internally must certainly not be pointed at customers.**

### A3. Multimodal customer support — **NOT VIABLE (policy)**

Vision analysis is governed and safe today precisely because it is **one-way**: image in, structured
analysis returned to its owner, consumed by no LLM. Making it conversational means feeding image
content into a prompt, which is the exact step that creates an indirect prompt-injection path — an
attacker writes instructions into an image and they arrive as model input.

That needs an injection-defence design and a policy decision about what image content may influence.
Neither exists. Building it for a customer-facing surface would put the untested version in front of
the least trusted input source on the platform.

### A4. Scenario simulation / what-if — **NOT APPLICABLE**

Executive operational tooling. No customer meaning.

### A5. Service intelligence (coverage, ETA, availability) — **ALREADY EXISTS**

The customer app already consumes ETA and coverage intelligence from earlier phases. Phase 15 added
nothing there and did not degrade it. Re-exposing it under a Phase-15 label would be relabelling,
not integration.

---

## B. What was NOT the reason

None of these were blocked by effort. Each has a measured, specific blocker:

| Candidate | Blocker | Evidence |
|---|---|---|
| Recommendations | data | 30 customers with repeat behaviour |
| Cancellation messaging | model quality | 0.24 SE margin |
| Multimodal support | policy + security design | no injection-defence design exists |
| Simulation | not applicable | executive tooling |
| Service intelligence | already shipped | pre-Phase-15 |

---

## C. What would unblock each

| Candidate | Requirement | Owner |
|---|---|---|
| Recommendations | Repeat-booking depth — a marketplace-maturity outcome, not an engineering task | Business |
| Cancellation messaging | A model with a margin outside its error bar, **and** an intervention-effectiveness measurement | ML + Product |
| Multimodal support | Injection-defence design + a policy on what image content may influence | Security + Policy |

---

## D. If any of these ships later, it must pass

Recorded now so the bar is set before there is pressure to ship:

```
auth → RBAC → privacy → budget → rate limit → audit → observability
     → feature flag (DRAFT → SHADOW → CONTROLLED → PRODUCTION)
     → failure handling → honest empty/unknown/stale states
```

Phase-14 and Phase-15 controls already cover the provider-facing half: any AI call from a customer
path inherits the spend cap, rate limit, cost accounting and audit, and the bypass guard fails the
build if a new raw provider call appears.

**The gap is not the controls. It is the evidence that the intelligence is worth showing.**

---

## E. Verdict

**No customer-facing Phase-15 surface was added, and none should have been.**

Claiming customer integration by shipping a popularity ranker labelled as personalisation, or a
coin-flip cancellation nudge, would satisfy a checklist and mislead real users. §AH is explicit:
the platform must be intelligent **and** truthful, and where ML is not justified the honest move is
the validated deterministic path — which, for everything a customer sees today, already exists and
already ships.
