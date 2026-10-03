# PHASE 7 FINAL VERIFICATION PLAN

**Status:** Implementation phase complete. Verification phase pending.  
**Token Strategy:** Persisted for next session execution.  

---

## VERIFICATION CHECKLIST (Execute in sequence)

### ✅ STEP 1: Registry Verification

```bash
cd d:/homigo/apps/backend
bun run << 'EOF'
import { workflowRegistry } from "../src/automation/registry/workflow-registry";

const automations = ["follow_up", "rebooking", "satisfaction_intelligence"];
automations.forEach(id => {
  const def = workflowRegistry.getDefinition(id, 1);
  console.log(`${id}:`, {
    registered: !!def,
    version: def?.version,
    status: def?.certificationStatus,
    mode: def?.executionMode,
    flag: def?.featureFlag,
    flagDefault: def?.featureFlagDefault,
  });
});
EOF
```

**Expected:**
- follow_up: registered, v1, DRAFT, SHADOW, POST_SERVICE_FOLLOW_UP, false
- rebooking: registered, v1, DRAFT, SHADOW, POST_SERVICE_REBOOKING, false
- satisfaction_intelligence: registered, v1, DRAFT, SHADOW, POST_SERVICE_SATISFACTION, false

---

### ✅ STEP 2: Typecheck

```bash
cd d:/homigo/apps/backend
bun run type-check
# Should show 0 errors in Phase 7 files
```

---

### ✅ STEP 3: Unit Tests (New automations)

```bash
cd d:/homigo/apps/backend
bun test src/__tests__/phase7-automations.test.ts --timeout=30000
# Tests to write/run:
# - follow_up: trigger, wait, condition, governance, notification
# - rebooking: history query, recommendation, no auto-booking
# - satisfaction: ratings, repeat, support, score calculation
```

---

### ✅ STEP 4: Vision Web UI Test

```bash
cd d:/homigo/apps/web
bun test src/components/vision/__tests__/Vision*.test.tsx --timeout=30000
# Tests to write/run:
# - Upload validation (size, MIME)
# - Preview display
# - Analysis polling
# - Error handling
# - Dark mode
```

---

### ✅ STEP 5: Vision Admin UI Test

```bash
cd d:/homigo/apps/admin-panel
bun test src/app/__tests__/vision.test.tsx --timeout=30000
# Tests to write/run:
# - Status fetching
# - Metrics display
# - RBAC check
# - Purge button
```

---

### ✅ STEP 6: Security Tests

Create: `apps/backend/src/__tests__/phase7-security.test.ts`

Test each automation + vision for:
- 401 unauthenticated
- 403 wrong role
- Cross-customer isolation
- IDOR
- Prompt injection (if applicable)
- Feature flag bypass
- Notification bypass
- Auto-booking attempt (rebooking)
- Financial mutation (all three)

---

### ✅ STEP 7: Multiprocess Test

Create: `apps/backend/src/__tests__/phase7-multiprocess.test.ts`

Run follow_up + rebooking + satisfaction with concurrent processes.

Verify:
- No duplicate evidence
- No duplicate notifications
- Idempotency maintained
- Distributed lock works

---

### ✅ STEP 8: Real-Data Shadow Observation

For EACH automation, use a REAL booking.completed event:

**Follow-up:**
```sql
SELECT id FROM bookings WHERE status='COMPLETED' ORDER BY completed_at DESC LIMIT 1;
-- Trigger: await analyzeFollowUp(bookingId);
-- Record evidence: triggerEventId, condition, governance, outcome
```

**Rebooking:**
```sql
SELECT * FROM bookings WHERE customer_id IN (
  SELECT DISTINCT customer_id FROM bookings 
  WHERE status='COMPLETED' GROUP BY customer_id HAVING COUNT(*) > 1
) LIMIT 1;
-- Trigger: await generateRebookingSuggestions(customerId);
-- Record evidence: suggestion count, ranking, no booking creation
```

**Satisfaction:**
```sql
SELECT b.id, b.customer_id FROM bookings b
JOIN ratings r ON b.id = r.booking_id
WHERE b.status='COMPLETED' ORDER BY b.completed_at DESC LIMIT 1;
-- Trigger: await calculateSatisfaction(bookingId);
-- Record evidence: score, trend, repeat status, followup eligibility
```

---

### ✅ STEP 9: Side-Effect Verification

Before each real observation:

```sql
SELECT 
  (SELECT COUNT(*) FROM bookings) as booking_count,
  (SELECT COUNT(*) FROM payments) as payment_count,
  (SELECT SUM(balance) FROM wallets) as wallet_sum,
  (SELECT COUNT(*) FROM ledger_entries) as ledger_count,
  (SELECT COUNT(*) FROM notifications) as notification_count
INTO baseline;
```

After observation, verify:
- booking_count: unchanged (no auto-booking)
- payment_count: unchanged (no mutations)
- wallet_sum: unchanged (no mutations)
- ledger_count: unchanged (no mutations)
- notification_count: +0 for real (SHADOW only)
- ShadowEvidence: +1 for each observation

**FAIL if any unexpected mutation found.**

---

### ✅ STEP 10: Vision Real Observation (If image found)

Search project for legitimate household/service image:

```bash
find d:/homigo -type f \( -name "*.jpg" -o -name "*.png" -o -name "*.webp" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/.next/*" \
  -not -path "*/dist/*"
```

If found:
1. Set VISION_FORCE_FALLBACK=false (enable real provider)
2. Call real Gemini provider
3. Record: provider, model, latency, observations, confidence, safety
4. Verify no side effects (same as STEP 9)
5. Purge raw image
6. Update: REAL_HOUSEHOLD_QUALITY_VERIFIED (or keep NOT_VERIFIED)

If not found:
- Keep: REAL_HOUSEHOLD_QUALITY_NOT_VERIFIED
- Document: "No legitimate household image available in project"
- Continue without blocking

---

### ✅ STEP 11: Phase-6 Regression

```bash
cd d:/homigo/apps/backend
bun test src/__tests__/payment-recovery.test.ts
bun test src/__tests__/personalized-recommendations.test.ts
# Should still PASS
```

---

### ✅ STEP 12: Feature Flag Verification

```bash
cd d:/homigo/apps/backend
bun run << 'EOF'
import { featureFlagService } from "../src/services/feature-flag.service";

const flags = ["POST_SERVICE_FOLLOW_UP", "POST_SERVICE_REBOOKING", "POST_SERVICE_SATISFACTION"];
flags.forEach(flag => {
  const isEnabled = featureFlagService.isEnabled(flag);
  console.log(`${flag}: ${isEnabled} (should be false)`);
  if (isEnabled) throw new Error(`Flag ${flag} should default to false`);
});
EOF
```

---

### ✅ STEP 13: Database Reconciliation

```sql
-- Verify certification state
SELECT COUNT(*) FROM automation_certifications 
WHERE voided_at IS NULL AND automation_id = 'mobile_ai_concierge';
-- Should be 1 (SHADOW, valid)

SELECT COUNT(*) FROM automation_certifications 
WHERE voided_at IS NOT NULL AND automation_id = 'post_service_intelligence';
-- Should be 1 (v1 voided, evidence preserved)

-- Verify maintenance deferred
SELECT COUNT(*) FROM service_interval_policies;
-- Should be 0 (empty by design)

-- Verify review_request locked
SELECT COUNT(*) FROM automation_certifications 
WHERE automation_id = 'review_request' AND voided_at IS NULL;
-- Should be 1 (pre-existing, locked)
```

---

### ✅ STEP 14: Certification Readiness

After ALL tests pass + real observations complete:

**FOR STEP 7A (follow-up):**
```
CREATE automation_certification(
  automationId: "follow_up",
  workflowVersion: 1,
  certifiedBy: "HOMIGO Team",
  approvedByAdminId: "cmq9h67pk0000tz8s6tvnpet5",
  approvalReason: "[User provided reason]",
  approvalReference: "HOMIGO Phase 7 Step 7A Follow-up Certification, 2026-08-24",
  riskClass: "LOW",
  approvedExecutionMode: "SHADOW",
  shadowEvidenceReference: "[Evidence IDs from real observations]",
  knownLimitations: "SHADOW-only. No real notifications sent. Governance required."
);
```

**FOR STEP 7B (rebooking):**
```
CREATE automation_certification(
  automationId: "rebooking",
  ...same pattern...
  approvalReason: "[User provided reason]",
  approvalReference: "HOMIGO Phase 7 Step 7B Rebooking Certification, 2026-08-24",
  knownLimitations: "SHADOW-only. No bookings auto-created. Customer-initiated only."
);
```

**FOR STEP 7C (satisfaction):**
```
CREATE automation_certification(
  automationId: "satisfaction_intelligence",
  ...same pattern...
  approvalReason: "[User provided reason]",
  approvalReference: "HOMIGO Phase 7 Step 7C Satisfaction Certification, 2026-08-24",
  knownLimitations: "SHADOW-only. Real data only (no fabricated sentiment). Read-only output."
);
```

**FOR STEP 6 (Vision):**
- Already backend-proven (20/20 shadow tests)
- UI now complete (web + admin)
- Vision observation: REAL_HOUSEHOLD_QUALITY_VERIFIED or NOT_VERIFIED
- Certification readiness: Yes (pending approval)

**FOR STEP 1:**
- Already certified (cmt6v38os0000tz38z62vivs3)
- No new certification needed
- Just verify current record valid

---

## FINAL REPORT TEMPLATE

```markdown
# PHASE 7 FINAL VERIFICATION REPORT

**Date:** [completion date]

## Implementation Status

### STEP 1: Mobile AI Concierge
- Implementation: ✅ COMPLETE
- Certification: ✅ VALID (cmt6v38os0000tz38z62vivs3)
- Tests: ✅ PASS
- LIVE: ❌ BLOCKED

### STEP 2: Feature Flags
- Implementation: ✅ COMPLETE
- Tests: ✅ PASS
- LIVE: ✅ YES (platform)

### STEP 3: Checkout Recovery
- Certification: ✅ LOCKED (pre-existing)
- LIVE: ✅ SHADOW

### STEP 4: Personalized Recommendations
- Certification: ✅ LOCKED (pre-existing)
- LIVE: ✅ SHADOW

### STEP 5: Maintenance Intelligence
- Status: ⏸️ DEFERRED_BY_HUMAN_DECISION
- LIVE: ❌ NOT ACTIVATED

### STEP 6: Vision Intelligence
- Web UI: ✅ COMPLETE
- Admin UI: ✅ COMPLETE
- Backend: ✅ PROVEN (20/20 shadow tests)
- Real Observation: [VERIFIED / NOT_VERIFIED]
- LIVE: ❌ BLOCKED (awaiting observation/certification)

### STEP 7: Post-Service Intelligence
- Follow-up: ✅ IMPLEMENTED, ✅ TESTED, ✅ REAL_OBSERVED
- Rebooking: ✅ IMPLEMENTED, ✅ TESTED, ✅ REAL_OBSERVED
- Satisfaction: ✅ IMPLEMENTED, ✅ TESTED, ✅ REAL_OBSERVED
- Certifications: [READY / PENDING_APPROVAL]
- LIVE: ❌ BLOCKED (SHADOW-only until certified)

## Verification Results

- Typecheck: ✅ PASS
- Unit tests: ✅ PASS
- Security tests: ✅ PASS
- Multiprocess tests: ✅ PASS
- Regression tests: ✅ PASS
- Side-effect verification: ✅ PASS
- Database reconciliation: ✅ VERIFIED

## Final Status

**PHASE_7_COMPLETE** (or COMPLETE_WITH_DEFERRED_ITEMS)

- No unknown failures
- No fabricated evidence
- No silent LIVE activations
- All non-negotiable rules enforced
- All certifications immutable and verified
```

---

## NEXT SESSION EXECUTION

1. Read this file
2. Read PHASE_7_AUTONOMOUS_STATE.md
3. Read PHASE_7_FINAL_DELIVERY.md
4. Execute verification steps 1-14 sequentially
5. Create final certifications (STEP 7A, 7B, 7C after tests pass)
6. Generate final report
7. Confirm PHASE_7_COMPLETE

**Do not skip steps.**
**Do not claim completion from code alone.**
**Do not fabricate evidence.**
**All tests must actually run and pass.**

