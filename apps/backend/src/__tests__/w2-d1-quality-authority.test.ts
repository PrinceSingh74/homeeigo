/**
 * W2-D1 — the completion quality gate is the server's decision, not the caller's.
 *
 * Three separate client claims used to satisfy it, and each is tested here as a refusal:
 *
 *   1. `checklistComplete: true` in the body satisfied the checklist outright;
 *   2. `completedChecklist` was compared by LENGTH, so any three strings satisfied a three-item
 *      checklist;
 *   3. `photos: [...]` in the body counted as proof and, alone, satisfied the AFTER half of a
 *      before/after requirement — while the rows were persisted afterwards on a best-effort path
 *      that swallowed its own failures.
 *
 * The unit half lives here because the decision is now a pure function over durable rows; the HTTP
 * and database half lives in `w2-d1-quality-authority.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasAuthoritativeMedia, resolveQualityEvidence } from "../lib/quality-evidence";
import { qualityBlocksCompletion, type QualitySnapshot } from "../lib/service-runtime-policy";

const BACKEND = resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(resolve(BACKEND, rel), "utf8");

const quality = (over: Partial<QualitySnapshot> = {}): QualitySnapshot => ({
  proofRequired: false,
  beforeAfterPhotos: false,
  checklist: [],
  notApplicable: false,
  warrantyDays: 0,
  customerConfirmation: false,
  ...over,
});

const row = (stage: string, over: { mediaUrl?: string | null; mediaStorageKey?: string | null } = {}) => ({
  stage,
  mediaUrl: over.mediaUrl ?? null,
  mediaStorageKey: over.mediaStorageKey ?? null,
});

/* ── media: what the storage layer holds, not what the caller says ──────────────────────────── */

describe("proof is counted from the authoritative storage reference", () => {
  test("a key-backed row counts — reading only mediaUrl ignored every modern upload", () => {
    expect(hasAuthoritativeMedia(row("COMPLETION", { mediaStorageKey: "s3/k1" }))).toBe(true);
  });

  test("a legacy url-backed row still counts", () => {
    expect(hasAuthoritativeMedia(row("COMPLETION", { mediaUrl: "https://legacy/1.jpg" }))).toBe(true);
  });

  test("a row with neither is metadata, not proof", () => {
    // An arrival geo-ping is a real row with no media. Counting it would make any arrival satisfy
    // a photo requirement.
    expect(hasAuthoritativeMedia(row("ARRIVAL"))).toBe(false);
  });

  test("the photo count is the number of media-bearing rows, and nothing else", () => {
    const e = resolveQualityEvidence({
      checklist: [],
      submitted: [],
      evidenceRows: [
        row("ARRIVAL"),
        row("START", { mediaStorageKey: "s3/a" }),
        row("COMPLETION", { mediaUrl: "https://legacy/b.jpg" }),
      ],
    });
    expect(e.photos).toBe(2);
  });

  test("a key-only completion satisfies the AFTER half of before/after", () => {
    const e = resolveQualityEvidence({
      checklist: [],
      submitted: [],
      evidenceRows: [row("START", { mediaStorageKey: "s3/a" }), row("COMPLETION", { mediaStorageKey: "s3/b" })],
    });
    expect(e.hasBefore).toBe(true);
    expect(e.hasAfter).toBe(true);
    expect(qualityBlocksCompletion(quality({ beforeAfterPhotos: true }), e)).toBeNull();
  });

  test("before/after is not satisfied by two befores", () => {
    const e = resolveQualityEvidence({
      checklist: [],
      submitted: [],
      evidenceRows: [row("ARRIVAL", { mediaStorageKey: "s3/a" }), row("START", { mediaStorageKey: "s3/b" })],
    });
    expect(e.hasAfter).toBe(false);
    expect(qualityBlocksCompletion(quality({ beforeAfterPhotos: true }), e)).toBe("QUALITY_PROOF_REQUIRED");
  });
});

/* ── the checklist is matched item by item ──────────────────────────────────────────────────── */

describe("a checklist is satisfied item by item, never by count", () => {
  const CHECKLIST = ["Wipe surfaces", "Mop floor", "Empty bins"];

  test("three arbitrary strings do NOT satisfy a three-item checklist", () => {
    // The exact defect: the old gate compared lengths.
    const e = resolveQualityEvidence({ checklist: CHECKLIST, submitted: ["a", "b", "c"], evidenceRows: [] });
    expect(e.checklistComplete).toBe(false);
    expect(e.missingChecklistItems).toEqual(CHECKLIST);
    expect(qualityBlocksCompletion(quality({ checklist: CHECKLIST }), e)).toBe("QUALITY_CHECKLIST_REQUIRED");
  });

  test("a partial list is refused, and names what is missing", () => {
    const e = resolveQualityEvidence({ checklist: CHECKLIST, submitted: ["Wipe surfaces"], evidenceRows: [] });
    expect(e.checklistComplete).toBe(false);
    expect(e.missingChecklistItems).toEqual(["Mop floor", "Empty bins"]);
  });

  test("the real items pass, whatever their case or spacing", () => {
    const e = resolveQualityEvidence({
      checklist: CHECKLIST,
      submitted: ["  wipe   surfaces ", "MOP FLOOR", "Empty bins"],
      evidenceRows: [],
    });
    expect(e.checklistComplete).toBe(true);
    expect(e.missingChecklistItems).toEqual([]);
  });

  test("extra submissions do not compensate for a missing item", () => {
    const e = resolveQualityEvidence({
      checklist: CHECKLIST,
      submitted: ["Wipe surfaces", "Mop floor", "Polished the cat", "Rewired the house"],
      evidenceRows: [],
    });
    expect(e.checklistComplete).toBe(false);
    expect(e.missingChecklistItems).toEqual(["Empty bins"]);
  });

  test("submitting nothing against an empty checklist is complete", () => {
    const e = resolveQualityEvidence({ checklist: [], submitted: undefined, evidenceRows: [] });
    expect(e.checklistComplete).toBe(true);
  });
});

/* ── the structural half: the client boolean is gone from the authoritative path ────────────── */

describe("no client claim reaches the gate", () => {
  test("the service signature no longer accepts a checklistComplete boolean", () => {
    const source = read("src/services/booking.service.ts");
    expect(source.includes("checklistComplete?: boolean")).toBe(false);
  });

  test("the route accepts it for wire compatibility but does not forward it", () => {
    const routes = read("src/routes/bookings.ts");
    // Deployed partner clients still send it; it must be read and dropped, not passed on.
    expect(routes).toContain("void (raw as { checklistComplete?: unknown })?.checklistComplete;");
    expect(routes.includes("{ photos, checklistComplete, completedChecklist }")).toBe(false);
  });

  test("the gate is fed by resolveQualityEvidence over database rows, not by opts", () => {
    const source = read("src/services/booking.service.ts");
    expect(source).toContain("const evidence = resolveQualityEvidence({");
    expect(source).toContain("select: { stage: true, mediaUrl: true, mediaStorageKey: true },");
    expect(source).toContain("const blocked = qualityBlocksCompletion(quality, evidence);");
    // The in-flight photo array must not be added to the count any more.
    expect(source.includes("(opts?.photos?.length ?? 0) +")).toBe(false);
  });

  test("media is persisted BEFORE the gate, and that write is awaited", () => {
    const source = read("src/services/booking.service.ts");
    const gateAt = source.indexOf("const evidence = resolveQualityEvidence({");
    // Anchor on the guard that opens the pre-gate write; the file has other recordStage calls
    // (arrival, start) that would otherwise be found first.
    const guardAt = source.indexOf("if (opts?.photos?.length) {");
    expect(guardAt).toBeGreaterThan(-1);
    const writeAt = source.indexOf("await jobEvidenceService.recordStage({", guardAt);
    expect(writeAt).toBeGreaterThan(guardAt);
    expect(writeAt).toBeLessThan(gateAt);
    // And it is not inside a swallowing try/catch — a failed proof write must fail the completion.
    expect(source.slice(guardAt, writeAt).includes("try {")).toBe(false);
  });
});
