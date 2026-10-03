# PHASE 7 WORK MANIFEST — Autonomous Continuation

**Current Session:** Token limit approaching  
**Persistence Strategy:** Manifest files for next session continuation  

---

## IMMEDIATE NEXT WORK (Priority Order)

### STEP 6A: Vision Web UI (HIGH_PRIORITY)

**Location:** `apps/web/src/app/(with-bottom-nav)/vision/page.tsx`

**Components Needed:**

1. **VisionUploadZone.tsx**
   - Drag-drop file input
   - File picker fallback
   - Max 8MB validation
   - MIME type validation (JPEG/PNG/WebP)
   - Real-time validation feedback
   - Upload progress indicator

2. **VisionImagePreview.tsx**
   - Display uploaded image
   - Show file size/type/dimensions
   - Timestamp
   - Delete button

3. **VisionAnalysisDisplay.tsx**
   - Show provider (Gemini or Fallback)
   - Show mode (REAL or SHADOW via VISION_FORCE_FALLBACK)
   - Structured analysis result
   - Confidence level
   - Safety flags
   - Observations/recommendations
   - Loading state during analysis

4. **VisionPage.tsx** (main page)
   - Auth check (useAuthStore)
   - State: UPLOAD → PREVIEW → ANALYZING → RESULT
   - Call `/api/vision/images/submit` with base64 bytes
   - Poll `/api/vision/images/{id}/analysis` until complete
   - Error recovery + retry
   - Dark/light mode support

**Backend Contract:**
- POST /api/vision/images/submit → returns {data: {id, ownerId, uploadedAt}}
- POST /api/vision/images/{id}/analyze → async, returns 200 immediately
- GET /api/vision/images/{id}/analysis → returns {status, result, confidence, safetyFlags, mode}
- GET /api/vision/images/{id} → metadata
- POST /api/vision/admin/purge → cleanup

**Tests Needed:**
- Upload validation (size, mime)
- Ownership isolation
- Analysis polling
- Error handling
- Dark mode
- Offline behavior (if applicable)

---

### STEP 6B: Vision Admin UI (MEDIUM_PRIORITY)

**Location:** `apps/admin-panel/src/app/(console)/vision/page.tsx`

**Display:**
- Vision usage statistics
- Analysis count (real vs fallback)
- Provider/mode breakdown
- Failure rates
- Retention policy status
- Purge controls

**Backend:** Use GET /api/vision/status + aggregations

---

### STEP 7A: Follow-Up Automation (HIGH_PRIORITY_IMPLEMENTATION)

**File:** `apps/backend/src/automation/registry/definitions/post-service.ts`

**Workflow:**
```
Event: booking.completed
Wait: 2 hours
Condition: customer.hasActiveSession OR customer.recentlyActive
Governance: NotificationGovernance (do NOT bypass)
Action: SHADOW notification → follow-up message
Evidence: Store in ShadowEvidence table
```

**Implementation:**
- Register in automation registry
- Use existing WorkflowEngine
- Use existing NotificationGovernance
- Feature flag: POST_SERVICE_FOLLOW_UP (default OFF)
- Tests: auth, isolation, governance, idempotency, real event

**Real Observation:**
- Capture one genuine completed booking
- Record: triggerEventId, conditionResult, governanceResult, outcome, source=OBSERVATION

---

### STEP 7B: Rebooking Automation (HIGH_PRIORITY_IMPLEMENTATION)

**File:** `apps/backend/src/automation/registry/definitions/rebooking.ts`

**Algorithm:**
- Get customer history (completed bookings, repeat count)
- Get service recommendations from existing recommendation engine
- Output: REBOOKING_SUGGESTIONS (not auto-booking)
- Customer must explicitly initiate booking

**Tests:**
- Customer isolation
- Recommendation ranking
- Inactive service filtering
- Empty history handling
- Authorization
- Prompt injection (if AI-augmented)

**Real Observation:**
- Shadow: Generate suggestions
- Verify: No booking auto-created, only recommendations shown

---

### STEP 7C: Satisfaction Intelligence (HIGH_PRIORITY_IMPLEMENTATION)

**File:** `apps/backend/src/automation/registry/definitions/satisfaction.ts`

**Data Points (Real Only):**
- Booking ratings (1-5)
- Review text (if provided)
- Repeat booking rate
- Support ticket correlation

**Output:**
- Service quality summary (safe text)
- Follow-up eligibility (boolean)
- Satisfaction trend (upward/stable/downward)

**NO:**
- Fabricated sentiment model
- ML-generated emotions
- Invented happiness score

---

### STEP 6D: Real Household Observation (BLOCKED_PENDING)

**Search locations:**
- apps/backend/fixtures
- apps/backend/data
- apps/web/public/images
- docs/examples

**If found:**
- Call real Gemini provider (disable VISION_FORCE_FALLBACK)
- Record: provider, model, latency, observations, confidence, safety
- Verify no side effects (bookings, payments, wallet, ledger)
- Purge raw image
- Update classification: REAL_HOUSEHOLD_QUALITY_VERIFIED

**If not found:**
- Keep: REAL_HOUSEHOLD_QUALITY_NOT_VERIFIED
- Continue without blocking other work

---

## DATABASE INTEGRITY CHECKS

Before final certification:

```sql
SELECT COUNT(*) FROM automation_certifications WHERE voided_at IS NULL AND automation_id IN ('mobile_ai_concierge', 'post_service_intelligence');
SELECT * FROM service_interval_policies;
SELECT COUNT(*) FROM workflow_instances WHERE automation_id LIKE 'post_service_%' AND created_at > now() - interval '1 day';
```

Expected:
- mobile_ai_concierge: 1 (SHADOW, valid)
- post_service_intelligence: 0 (voided)
- service_interval_policies: 0 (deferred)

---

## REGRESSION CHECKLIST

After all implementations:

- [ ] Phase 7 test suites (vision, follow-up, rebooking, satisfaction)
- [ ] Phase 6 critical suites (no regressions)
- [ ] Mobile AI Concierge (no changes to existing)
- [ ] Feature flags (no interference)
- [ ] Customer isolation (cross-user test)
- [ ] Notification governance (no bypasses)
- [ ] Side effects (capture before/after: bookings, payments, ledger)
- [ ] Security (auth, RBAC, injection, IDOR)

---

## FINAL GATE VERIFICATION

```
✅ STEP 1: Certified SHADOW
✅ STEP 2: Feature flags LIVE
✅ STEP 3: Certified SHADOW (locked)
✅ STEP 4: Certified SHADOW (locked)
⏸️ STEP 5: Deferred (no policy, no defect)
✅ STEP 6: UI complete + provider proven + observation (or NOT_VERIFIED)
✅ STEP 7: Follow-up + rebooking + satisfaction complete + certified SHADOW
❌ NO unknown failures
❌ NO fabricated evidence
❌ NO LIVE leaks
```

Result: PHASE_7_COMPLETE or COMPLETE_WITH_DEFERRED_ITEMS

---

## NEXT SESSION ENTRY POINT

1. Read this manifest
2. Read PHASE_7_AUTONOMOUS_STATE.md
3. Continue with: STEP 6A Vision Web UI (apps/web)
4. After each major component: update PHASE_7_AUTONOMOUS_STATE.md
5. Loop through: 6A → 6B → 7A → 7B → 7C → 6D → regression → final
6. Never stop the entire loop because one item is deferred

**Proceed without asking for confirmation on each step.**

