/**
 * W2-D1 — the ONE place that decides what counts as completion evidence.
 *
 * The quality gate used to accept three different client claims as proof:
 *
 *   1. `checklistComplete: true` in the request body satisfied the checklist outright;
 *   2. `completedChecklist` was compared by LENGTH, so three arbitrary strings satisfied a
 *      three-item checklist;
 *   3. `photos: [...]` in the body counted towards the photo requirement and, on its own, satisfied
 *      the AFTER half of a before/after requirement — while the rows themselves were persisted
 *      afterwards on a best-effort path that swallowed its own failures.
 *
 * So a partner client could complete a job with an untouched checklist and proof that was never
 * stored. This module exists so that decision is made once, from durable rows, and nowhere else.
 *
 * Two rules it enforces:
 *
 * **Media is what the server stored.** A row counts when its `mediaStorageKey` is a key the server
 * wrote for that booking, partner and stage (lib/job-evidence-media). A URL never counts, whatever it
 * points at, and neither does a key that arrived from a client: a link is a claim, not a photo.
 *
 * **A checklist is satisfied item by item, never by count.** Every item in the FROZEN snapshot must
 * be matched by something the partner actually submitted. Missing items are returned so the caller
 * can say which ones, instead of a bare refusal.
 *
 * Pure: no database, no clock, no client trust.
 */

import { isServerStoredEvidence } from "./job-evidence-media";

/** The subset of a `job_evidence` row this module needs. Anything else is none of its business. */
export type EvidenceRow = {
  stage: string;
  mediaUrl: string | null;
  mediaStorageKey?: string | null;
  /** When present, the key must have been stored for this booking and this partner. */
  bookingId?: string | null;
  providerId?: string | null;
};

export type QualityEvidence = {
  /** Rows that carry real media. Never includes anything the caller merely claimed. */
  photos: number;
  hasBefore: boolean;
  hasAfter: boolean;
  checklistComplete: boolean;
  /** Frozen checklist items the partner did not submit. Empty when complete. */
  missingChecklistItems: string[];
  /**
   * The assigned professional's own attestation that the completion criteria were met. It is a
   * declaration, not proof — it never substitutes for photos or the checklist, and it is asked for
   * only where the frozen policy sets `professionalConfirmation`.
   */
  professionalConfirmed?: boolean;
};

/**
 * Does this evidence row point at something the storage layer actually holds?
 *
 * `mediaStorageKey` is the current reference; `mediaUrl` is the legacy column kept for rows written
 * before the key existed. A row with neither is metadata — a geotagged arrival ping, say — and is
 * not proof of anything visual.
 */
export function hasAuthoritativeMedia(row: EvidenceRow): boolean {
  return isServerStoredEvidence({ mediaStorageKey: row.mediaStorageKey, bookingId: row.bookingId, providerId: row.providerId, stage: String(row.stage).toUpperCase() });
}

/** Stages that count as "before the work": the partner at the door, or starting. */
const BEFORE_STAGES = new Set(["ARRIVAL", "START"]);
const AFTER_STAGES = new Set(["COMPLETION"]);

/** Trim and case-fold so "Wipe surfaces " matches "wipe surfaces" without matching "wipe". */
function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * @param checklist  the FROZEN checklist from the booking's snapshot — never today's service config.
 * @param submitted  what the partner says they completed. Validated against `checklist`, not trusted.
 */
export function resolveQualityEvidence(input: {
  checklist: readonly string[];
  submitted: readonly string[] | undefined;
  evidenceRows: readonly EvidenceRow[];
}): QualityEvidence {
  const withMedia = input.evidenceRows.filter(hasAuthoritativeMedia);

  const submitted = new Set((input.submitted ?? []).map(normalise));
  const missingChecklistItems = input.checklist.filter((item) => !submitted.has(normalise(item)));

  return {
    photos: withMedia.length,
    hasBefore: withMedia.some((r) => BEFORE_STAGES.has(String(r.stage).toUpperCase())),
    hasAfter: withMedia.some((r) => AFTER_STAGES.has(String(r.stage).toUpperCase())),
    checklistComplete: missingChecklistItems.length === 0,
    missingChecklistItems,
  };
}
