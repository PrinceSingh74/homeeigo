/**
 * Found 2026-09-29, after the 25 contents went live (15 services with a mandatory BEFORE_AFTER_PHOTOS
 * step, 13 with a NOTE step): this app could not finish those steps — a PHOTO step needed a typed
 * evidence id no screen shows (X-36), the evidence panel uploads only COMPLETION photos (no "before"),
 * and "Done" on a NOTE step had no note field. A finished step also kept saying "needs a photo" (X-57).
 * Mirror of homigo-partner-mobile/src/lib/step-evidence.ts. Run from `apps/partner-web`: `bun test tests`.
 */
import { describe, expect, test } from "bun:test";
import { completeBody, completePlan, stepMetaLabel } from "@/lib/step-evidence";

describe("step state label (X-57)", () => {
  test("a finished step reports what was added instead of asking for it", () => {
    expect(stepMetaLabel("COMPLETED", "PHOTO")).toBe("Done · photo added");
    expect(stepMetaLabel("COMPLETED", "BEFORE_AFTER_PHOTOS")).toBe("Done · before & after photos added");
    expect(stepMetaLabel("COMPLETED", "NOTE")).toBe("Done · note added");
    expect(stepMetaLabel("COMPLETED", "NONE")).toBe("Done");
  });
  test("an open step says what it needs; a closed one asks for nothing", () => {
    expect(stepMetaLabel("IN_PROGRESS", "BEFORE_AFTER_PHOTOS")).toBe("In progress · needs before & after photos");
    expect(stepMetaLabel("READY", "NOTE")).toBe("Ready · needs a note");
    expect(stepMetaLabel("SKIPPED_WITH_REASON", "PHOTO")).toBe("Skipped");
    expect(stepMetaLabel("FAILED", "NOTE")).toBe("Failed");
  });
});

describe("what Done needs (server: booking-execution.service COMPLETE)", () => {
  test("before & after: a START photo then a COMPLETION photo", () => {
    expect(completePlan("BEFORE_AFTER_PHOTOS").photos.map((p) => p.stage)).toEqual(["START", "COMPLETION"]);
  });
  test("photo: one START photo; note: a note; none: nothing", () => {
    expect(completePlan("PHOTO").photos.map((p) => p.stage)).toEqual(["START"]);
    expect(completePlan("NOTE")).toMatchObject({ note: true, photos: [] });
    expect(completePlan("NONE")).toEqual({ note: false, photos: [], buttonLabel: "Done" });
  });
  test("the body carries the last uploaded photo and the trimmed note, nothing else", () => {
    expect(completeBody(completePlan("BEFORE_AFTER_PHOTOS"), ["ev-before", "ev-after"])).toEqual({ evidenceId: "ev-after" });
    expect(completeBody(completePlan("NOTE"), [], "  Scope agreed ")).toEqual({ note: "Scope agreed" });
    expect(completeBody(completePlan("NONE"), [])).toEqual({});
  });
});
