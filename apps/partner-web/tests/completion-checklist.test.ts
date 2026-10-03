/**
 * The service quality checklist on "Mark complete".
 *
 * Until 2026-09-28 the partner web app never sent `completedChecklist`, so every job whose service
 * carries a checklist was refused by the server (`QUALITY_CHECKLIST_REQUIRED`) with no way for the
 * partner to satisfy it. The pure logic is pinned here; the component only renders it.
 *
 * Run from `apps/partner-web`: `bun test tests`.
 */
import { describe, expect, test } from "bun:test";
import {
  buildCompletedChecklist,
  checklistCompletionFields,
  completionGate,
  describeCompletionRefusal,
  missingChecklistItems,
  parseExecutionQuality,
  QUALITY_CHECKLIST_REQUIRED,
} from "@/lib/completion-checklist";

const CHECKLIST = ["Wipe all surfaces", "Vacuum carpets", "Empty bins"];

describe("all items ticked", () => {
  test("Complete is allowed with no hint", () => {
    const gate = completionGate(CHECKLIST, ["Empty bins", "Wipe all surfaces", "Vacuum carpets"]);
    expect(gate.allowed).toBe(true);
    expect(gate.missing).toEqual([]);
    expect(gate.hint).toBeNull();
  });

  test("the body carries every item, as the exact strings, in checklist order", () => {
    // Ticked in a different order than the checklist — the wire keeps the checklist's order.
    const fields = checklistCompletionFields(CHECKLIST, ["Empty bins", "Wipe all surfaces", "Vacuum carpets"]);
    expect(fields).toEqual({ completedChecklist: CHECKLIST });
    expect(fields.completedChecklist).not.toBe(CHECKLIST);
  });

  test("a tick for a string that is not on the checklist is never sent", () => {
    const body = buildCompletedChecklist(CHECKLIST, [...CHECKLIST, "Polish the silver"]);
    expect(body).toEqual(CHECKLIST);
  });
});

describe("one item unticked", () => {
  test("Complete is not allowed and the missing item is named", () => {
    const gate = completionGate(CHECKLIST, ["Wipe all surfaces", "Empty bins"]);
    expect(gate.allowed).toBe(false);
    expect(gate.missing).toEqual(["Vacuum carpets"]);
    expect(gate.hint).toContain("1 checklist item");
  });

  test("the body carries only the ticked items — the client never claims the unticked one", () => {
    expect(buildCompletedChecklist(CHECKLIST, ["Wipe all surfaces", "Empty bins"])).toEqual([
      "Wipe all surfaces",
      "Empty bins",
    ]);
  });

  test("nothing ticked names every item", () => {
    const gate = completionGate(CHECKLIST, []);
    expect(gate.allowed).toBe(false);
    expect(gate.missing).toEqual(CHECKLIST);
    expect(gate.hint).toContain("every item");
  });

  test("matching is exact — a near-miss string is still missing", () => {
    expect(missingChecklistItems(CHECKLIST, ["wipe all surfaces", "Vacuum carpets ", "Empty bins"])).toEqual([
      "Wipe all surfaces",
      "Vacuum carpets",
    ]);
  });
});

describe("empty checklist", () => {
  test("Complete is allowed", () => {
    const gate = completionGate([], []);
    expect(gate.allowed).toBe(true);
    expect(gate.hint).toBeNull();
  });

  test("no completedChecklist key is sent", () => {
    expect(buildCompletedChecklist([], [])).toBeUndefined();
    const fields = checklistCompletionFields([], ["stray tick"]);
    expect(fields).toEqual({});
    expect("completedChecklist" in fields).toBe(false);
  });
});

describe("reading the frozen checklist off GET /api/bookings/:id", () => {
  test("data.booking.execution.quality is the wire path", () => {
    const q = parseExecutionQuality({
      success: true,
      data: {
        booking: {
          id: "b1",
          execution: {
            materials: null,
            equipment: null,
            durationMinutes: 60,
            quality: { proofRequired: true, beforeAfterPhotos: false, checklist: CHECKLIST, notApplicable: false, warrantyDays: 7, customerConfirmation: true },
          },
        },
      },
    });
    expect(q).toEqual({ checklist: CHECKLIST, proofRequired: true, beforeAfterPhotos: false });
  });

  test("a booking without execution, or with quality: null, has an empty checklist", () => {
    expect(parseExecutionQuality({ success: true, data: { booking: { id: "b1" } } }).checklist).toEqual([]);
    expect(parseExecutionQuality({ success: true, data: { booking: { id: "b1", execution: { quality: null } } } }).checklist).toEqual([]);
    expect(parseExecutionQuality(undefined).checklist).toEqual([]);
  });

  test("non-string checklist entries are dropped, string entries kept verbatim", () => {
    const q = parseExecutionQuality({ data: { booking: { execution: { quality: { checklist: [" Keep spaces ", 3, null, "x"] } } } } });
    expect(q.checklist).toEqual([" Keep spaces ", "x"]);
  });
});

describe("refusal mapping", () => {
  test("QUALITY_CHECKLIST_REQUIRED points the partner at the job page", () => {
    const r = describeCompletionRefusal({ code: QUALITY_CHECKLIST_REQUIRED, data: { verdictId: 42, verdict: "REWORK_REQUIRED" } }, "abc 1");
    expect(r).not.toBeNull();
    expect(r!.code).toBe("QUALITY_CHECKLIST_REQUIRED");
    expect(r!.href).toBe("/requests/abc%201");
    expect(r!.message).toMatch(/job page/);
    expect(r!.verdictId).toBe(42);
  });

  test("on the job page the message does not send the partner elsewhere", () => {
    const r = describeCompletionRefusal({ code: QUALITY_CHECKLIST_REQUIRED }, "b1", { onJobPage: true });
    expect(r!.message).not.toMatch(/job page/);
    expect(r!.verdictId).toBeNull();
  });

  test("other refusals are not mapped — they keep their own message", () => {
    expect(describeCompletionRefusal({ code: "QUALITY_PROOF_REQUIRED" }, "b1")).toBeNull();
    expect(describeCompletionRefusal({ code: "EXECUTION_GATE_BLOCKED" }, "b1")).toBeNull();
    expect(describeCompletionRefusal(new Error("network"), "b1")).toBeNull();
    expect(describeCompletionRefusal(null, "b1")).toBeNull();
  });
});
