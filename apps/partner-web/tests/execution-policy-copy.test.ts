/**
 * X-30: the partner brief must carry the booking's frozen materials / equipment policy. Partner
 * mobile showed it from `GET /api/bookings/:id` → execution.materials / execution.equipment
 * (apps/backend/src/lib/service-runtime-policy.ts `partnerExecutionFromSnapshot`); this app did not.
 * Run from `apps/partner-web`: `bun test tests`.
 */
import { describe, expect, test } from "bun:test";
import { parseExecutionPolicyCopy } from "@/lib/completion-checklist";

describe("frozen materials / equipment copy from the booking detail", () => {
  test("reads both strings exactly as the server froze them", () => {
    const r = { success: true, data: { booking: { id: "b1", execution: { materials: "Bring your own cleaning materials.", equipment: "The customer provides a ladder.", quality: null } } } };
    expect(parseExecutionPolicyCopy(r)).toEqual({ materials: "Bring your own cleaning materials.", equipment: "The customer provides a ladder." });
  });
  test("absent, null or non-string values are null — nothing is invented", () => {
    expect(parseExecutionPolicyCopy({ data: { booking: { id: "b1" } } })).toEqual({ materials: null, equipment: null });
    expect(parseExecutionPolicyCopy({ data: { booking: { execution: { materials: null, equipment: 3 } } } })).toEqual({ materials: null, equipment: null });
    expect(parseExecutionPolicyCopy({ data: { booking: { execution: { materials: "   " } } } })).toEqual({ materials: null, equipment: null });
    expect(parseExecutionPolicyCopy(undefined)).toEqual({ materials: null, equipment: null });
  });
});
