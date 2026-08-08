# Event Contract Investigation Summary

## The Problem

**Reported Issue:**
```
Invalid event type namespace: eta.feature.updated
Invalid event type namespace: eta.trip.completed
Invalid event type namespace: eta.label.created
```

**Impact:** 6 ETA events stuck in outbox with 6800+ failed retry attempts across 24+ hours.

---

## Root Cause (Proven)

**File:** `apps/backend/src/events/catalog/event-types.ts`

**Defect:** ETA events defined with `eta.*` namespace instead of required `homigo.*` namespace.

```typescript
// ❌ WRONG
ETA_LABEL_CREATED: "eta.label.created",
ETA_TRIP_COMPLETED: "eta.trip.completed",
ETA_FEATURE_UPDATED: "eta.feature.updated",

// ✓ CORRECT
ETA_LABEL_CREATED: "homigo.eta.label.created",
ETA_TRIP_COMPLETED: "homigo.eta.trip.completed",
ETA_FEATURE_UPDATED: "homigo.eta.feature.updated",
```

**Why:** Phase 0 event contract requires all events to start with "homigo." namespace.

Location of validation: `apps/backend/src/events/core/validation.ts:8`

```typescript
if (!payload.type.startsWith("homigo.")) {
  throw new Error(`Invalid event type namespace: ${payload.type}`);
}
```

---

## Evidence Chain

| Step | Finding | Source |
|------|---------|--------|
| 1 | Namespace validation enforces "homigo." | validation.ts:8 |
| 2 | ETA events use "eta." namespace | event-types.ts:15-17 |
| 3 | Mismatch = validation failure | outbox-processor.ts:113-119 |
| 4 | 6 events retry until terminal FAILED | Outbox query |
| 5 | All non-ETA events PUBLISHED | Outbox query (257 healthy) |
| 6 | No other code references "eta." namespace | Grep search |
| 7 | Fix updates 2 files only | Git diff |
| 8 | New test event passes validation | Runtime verification |

---

## The Fix

**Scope:** 2 files, 4 lines changed

### File 1: Event Type Constants
```diff
  apps/backend/src/events/catalog/event-types.ts
- ETA_LABEL_CREATED: "eta.label.created",
+ ETA_LABEL_CREATED: "homigo.eta.label.created",
```

### File 2: ETL Trigger Mapping
```diff
  apps/backend/analytics/scheduler/etl-scheduler.ts
- "eta.label.created": ["etl.eta"],
+ "homigo.eta.label.created": ["etl.eta"],
```

**Commit:** 914c7dd

---

## Verification

### Tests Passing

| Test Suite | Count | Status |
|-----------|-------|--------|
| Event namespace validation | 3 | ✓ PASS |
| Phase 0 event foundation | 8 | ✓ PASS |
| Phase 2 ETA intelligence | 4 | ✓ PASS |
| Runtime lifecycle | 6 steps | ✓ PASS |

### Outbox Health

| Metric | Before | After | Status |
|--------|--------|-------|--------|
| ETA FAILED events | 6 | 6 | Unchanged (old events) |
| ETA PENDING events | 0 | 1 | ✓ New event healthy |
| Non-ETA PUBLISHED | 257 | 257 | ✓ Still healthy |
| Validation errors | 6 | 0 | ✓ Fixed |

### No Regressions

- ✓ Phase 0 validation still enforces namespace
- ✓ Outbox processor unchanged
- ✓ Retry logic unchanged
- ✓ All prior tests still pass

---

## Certification Status

### Before Fix
```
Phase 0: PASS (validation working)
Phase 1: PASS (other events working)
Phase 2: FAIL (ETA events invalid)
Phase 3-5: BLOCKED (depend on Phase 2)
Event Contract: FAIL
```

### After Fix
```
Phase 0: PASS (validation still enforcing namespace)
Phase 1: PASS (other events still working)
Phase 2: PASS (ETA events now valid)
Phase 3-5: UNBLOCKED
Event Contract: PASS ✓
```

---

## Key Decisions

### Why Not Remove Validation?

**Rejected:** Removing namespace validation would:
- Break Phase 0 architecture
- Allow any event type format
- Compromise observability and routing
- Not actually fix the problem (just hide it)

### Why Rename to homigo.eta.*?

**Chosen:** Follows Phase 0 contract:
- All Homigo internal events use "homigo.*" prefix
- ETA is a Homigo domain, should be "homigo.eta.*"
- Minimal change (4 lines)
- Preserves all other functionality
- Correct per architecture

### Why Not Create Exception in Validation?

**Rejected:** Would:
- Introduce special case in contract logic
- Violate "no exceptions" principle
- Make future debugging harder
- Not architectural

---

## Lessons for Documentation

These should be added to CLAUDE.md:

1. **Event Namespace Requirement:** All events must start with "homigo." namespace
2. **Event Builder Pattern:** Use event-types constants, never hardcode event names
3. **Testing Gap:** Certification should validate outbox end-to-end
4. **Lint Rule Candidate:** Could enforce "homigo." prefix in event type definitions

---

## Artifacts Generated

1. **docs/final-certification/RUNTIME-EVENT-CONTRACT-VERIFICATION.md** — Complete certification report
2. **docs/evidence/runtime-event-contract/outbox-forensics.md** — Detailed forensic analysis
3. **docs/evidence/runtime-event-contract/INVESTIGATION-SUMMARY.md** — This document

---

## Deployment Readiness

✓ Fix tested and verified  
✓ All regressions checked  
✓ No database migrations needed  
✓ No new dependencies  
✓ Backward compatible  
✓ Ready to merge

**Recommendation:** Merge to main after Phase 2 regression verification.

---

**Status:** EVENT CONTRACT VERIFICATION COMPLETE ✓

**Next:** Phase 6 ready to proceed
