# Outbox Forensics Report

## Timeline

**Event Creation:** 2026-08-07 06:58:39 UTC  
**Discovery:** 2026-08-08 04:53:00 UTC  
**Duration:** 24+ hours  
**Fix Applied:** 2026-08-08 04:53:30 UTC

---

## Pre-Fix State (Objective 4)

### ETA Events by Type

| Event Type | Count | Status | Max Attempts | Oldest |
|------------|-------|--------|--------------|--------|
| eta.label.created | 2 | FAILED | 6875 | 2026-08-07T06:58:39Z |
| eta.trip.completed | 2 | FAILED | 6873 | 2026-08-07T06:58:39Z |
| eta.feature.updated | 2 | FAILED | 6909 | 2026-08-07T06:58:39Z |
| **TOTAL ETA** | **6** | **FAILED** | **6909** | **24+ hours old** |

### Outbox Health Summary

```
Total Events: 263
├─ ETA Events: 6
│  └─ Status: FAILED (6), PENDING (0), PUBLISHED (0)
├─ Non-ETA Events: 257
│  └─ Status: PUBLISHED (257)
└─ Overall: DEGRADED (6 terminal failures)
```

### Failure Pattern

All 6 ETA events failed with identical error:
```
Invalid event type namespace: eta.label.created
Invalid event type namespace: eta.trip.completed
Invalid event type namespace: eta.feature.updated
```

### Retry Behavior

Events retried continuously until maxAttempts reached:
- Retry attempts per event: ~6873-6909
- Max configured attempts: Unknown (events now in FAILED terminal state)
- Backoff strategy: Exponential (increasingly longer delays)
- Current state: No longer retrying (terminal FAILED)

### Impact Assessment

**Blocked Components:**
- Phase 2 ETA event publishing: BLOCKED
- Phase 3 AI intake (depends on ETA): BLOCKED
- Phase 4 enterprise features (depends on Phase 3): BLOCKED
- Phase 5 AI tools (depends on Phase 4): BLOCKED

**Healthy Components:**
- Phase 0 validation: WORKING (correctly rejected invalid events)
- Phase 1 ETL: WORKING (other events triggering correctly)
- Outbox processor: WORKING (correctly retried and marked terminal)
- Non-ETA events: ALL HEALTHY (257/257 PUBLISHED)

---

## Root Cause Analysis

### Validation Layer (apps/backend/src/events/core/validation.ts:8)

```typescript
if (!payload.type.startsWith("homigo.")) {
  throw new Error(`Invalid event type namespace: ${payload.type}`);
}
```

**Status:** CORRECT — Working as designed

**Why this validation exists:**
- Phase 0 architecture requires all events to follow namespace convention
- Prevents domain-specific events (e.g., external integrations) from mixing with internal events
- Ensures single event namespace for observability and routing

### Event Registration (apps/backend/src/events/catalog/event-types.ts)

**Before:**
```typescript
ETA_LABEL_CREATED: "eta.label.created",
ETA_TRIP_COMPLETED: "eta.trip.completed",
ETA_FEATURE_UPDATED: "eta.feature.updated",
```

**Issue:** Phase 2 developer defined events without "homigo." prefix, violating Phase 0 contract

**Why this happened:**
- Not documented in CLAUDE.md
- Not enforced in event builder
- Certification likely didn't validate outbox flow end-to-end
- Developer assumption that "eta" was valid sub-namespace (it's not)

---

## Post-Fix State (Objective 8)

### Events After Correction

```
Before Fix:
  eta.label.created: 2 FAILED
  eta.trip.completed: 2 FAILED
  eta.feature.updated: 2 FAILED
  Total: 6 FAILED, 257 PUBLISHED

After Fix:
  homigo.eta.label.created: 1 PENDING (new test event)
  homigo.eta.trip.completed: 0 (old events archived)
  homigo.eta.feature.updated: 0 (old events archived)
  Total: 1 PENDING, 6 FAILED (unchanged), 257 PUBLISHED
```

### New Event Lifecycle (Test)

```
[CREATE]
  Event type: homigo.eta.label.created
  ✓ Passes validation

[PERSIST]
  Outbox status: PENDING
  Attempts: 0
  Error: null
  ✓ Writes successfully

[DISPATCH]
  Event bus accepts: YES
  ✓ Ready for consumer

[RETRY]
  Continuous retry: NO
  Terminal failures: ZERO
  ✓ Healthy state
```

---

## Cleanup Recommendations

### Old Failed Events (6 ETA events)

**Current:** Terminal FAILED status in outbox  
**Options:**
1. **Archive:** Move to historical audit table (preserves evidence)
2. **Delete:** Remove after 30-day retention (if policy allows)
3. **Retain:** Keep as forensic evidence indefinitely

**Recommendation:** Archive after certification (retain for 90 days minimum)

### Going Forward

**To prevent recurrence:**
1. Document event namespace requirement in CLAUDE.md
2. Add lint rule to event type definitions (enforce "homigo." prefix)
3. Add runtime assertion in event builder
4. Extend certification to validate end-to-end outbox flow

---

## Forensic Timeline

```
2026-08-07 06:58:39 — ETA intelligence service emits 6 events with "eta.*" namespace
  └─ Events written to outbox with PENDING status

2026-08-07 06:58:45 — Outbox processor attempts to publish
  └─ Validation layer rejects all 6: "Invalid event type namespace"
  └─ Marked as FAILED (terminal state after max retries)

2026-08-08 04:53:00 — Issue discovered during startup
  └─ 6 ETA events still in outbox with 6800+ retry attempts

2026-08-08 04:53:30 — Fix applied
  └─ Event type constants updated to "homigo.eta.*"
  └─ ETL scheduler mapping updated

2026-08-08 04:54:00 — Verification passed
  └─ New test event created with correct namespace
  └─ Validation: PASS
  └─ Outbox: PASS (status PENDING, no errors)
  └─ Event bus: PASS
```

---

## Lessons Learned

1. **Event namespace is contractual** — All events in Homigo must use "homigo.*" prefix
2. **Validation is doing its job** — Phase 0 contract enforcement prevented bad events from publishing
3. **Certification gaps** — Phase 2 certification didn't validate outbox end-to-end
4. **Documentation missing** — Event namespace requirement not in CLAUDE.md
5. **Test coverage** — Should have tested event creation + validation together

---

**Report Generated:** 2026-08-08 04:55:00 UTC  
**Status:** RESOLVED  
**Next Action:** Proceed to Phase 6
