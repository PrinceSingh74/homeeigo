/**
 * Phase 10 §8 — what a work step needs to be marked done, and how its state reads (pure, unit-tested;
 * mirror of homigo-partner-mobile/src/lib/step-evidence.ts).
 *
 * The server decides (apps/backend/src/services/booking-execution.service.ts, COMPLETE):
 *  - NOTE                 the note in the body;
 *  - PHOTO                `evidenceId` of a real job_evidence photo of this booking;
 *  - BEFORE_AFTER_PHOTOS  a before photo (ARRIVAL/START stage) AND an after photo (COMPLETION stage).
 * Before 2026-09-29 partner web could not finish these steps: a PHOTO step needed a typed evidence id
 * nothing displayed (X-36), no "before" photo could be added, "Done" on a NOTE step had no note field,
 * and a finished step still read "needs a photo" (X-57).
 */
export type EvidenceStage = "START" | "COMPLETION";
export type CompletePlan = { note: boolean; photos: Array<{ stage: EvidenceStage; prompt: string }>; buttonLabel: string };

const STATE_LABEL: Record<string, string> = {
  READY: "Ready", BLOCKED: "Blocked", PENDING: "Not started", IN_PROGRESS: "In progress", COMPLETED: "Done",
  SKIPPED_WITH_REASON: "Skipped", FAILED: "Failed", ESCALATED: "Escalated",
};
const NEEDS: Record<string, string> = { NOTE: "a note", PHOTO: "a photo", BEFORE_AFTER_PHOTOS: "before & after photos" };
const RECORDED: Record<string, string> = { NOTE: "note added", PHOTO: "photo added", BEFORE_AFTER_PHOTOS: "before & after photos added" };
const CLOSED = new Set(["SKIPPED_WITH_REASON", "FAILED", "ESCALATED"]);

export function stepStateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

export function stepMetaLabel(state: string, evidence: string): string {
  const base = stepStateLabel(state);
  if (!NEEDS[evidence] || CLOSED.has(state)) return base;
  if (state === "COMPLETED") return `${base} · ${RECORDED[evidence]}`;
  return `${base} · needs ${NEEDS[evidence]}`;
}

export function completePlan(evidence: string): CompletePlan {
  if (evidence === "NOTE") return { note: true, photos: [], buttonLabel: "Add note · Done" };
  if (evidence === "PHOTO") return { note: false, photos: [{ stage: "START", prompt: "Add a photo of this step to mark it done" }], buttonLabel: "Add photo · Done" };
  if (evidence === "BEFORE_AFTER_PHOTOS") {
    return {
      note: false,
      photos: [
        { stage: "START", prompt: "Add a BEFORE photo of this step to mark it done" },
        { stage: "COMPLETION", prompt: "Add an AFTER photo of this step to mark it done" },
      ],
      buttonLabel: "Add before & after photos · Done",
    };
  }
  return { note: false, photos: [], buttonLabel: "Done" };
}

/** The COMPLETE body: the last uploaded photo (the after photo for before/after) and the note — nothing else. */
export function completeBody(plan: CompletePlan, uploadedIds: string[], note?: string): Record<string, string> {
  const body: Record<string, string> = {};
  const last = uploadedIds[uploadedIds.length - 1];
  if (plan.photos.length && last) body.evidenceId = last;
  if (plan.note && note?.trim()) body.note = note.trim();
  return body;
}
