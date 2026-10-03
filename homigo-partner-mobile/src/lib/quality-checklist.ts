/**
 * Service quality checklist at completion — the pure half of W2-D1 on the partner app.
 *
 * `POST /api/bookings/:id/complete` matches `completedChecklist` ITEM BY ITEM against the booking's
 * FROZEN checklist (backend `lib/quality-evidence.ts` `resolveQualityEvidence`) and refuses with
 * `QUALITY_CHECKLIST_REQUIRED` while any item is missing. The partner reads the frozen list from
 * `GET /api/bookings/:id` → `booking.execution.quality.checklist`, ticks each item as they finish it,
 * and this module turns those ticks into the request body. The server remains the authority: after a
 * refusal, the last entry of `GET /api/bookings/:id/quality` `history` names `missingChecklistItems`,
 * and `describeChecklistRefusal` maps that back onto the rows the partner still has to tick.
 *
 * Nothing here is ever filled in for the partner — an all-ticked list only exists because the partner
 * tapped every row. No react-native imports: this file runs under `node --test`.
 */

export const QUALITY_CHECKLIST_REQUIRED = "QUALITY_CHECKLIST_REQUIRED";

export const CHECKLIST_INCOMPLETE_HINT = "Tick every checklist item to complete this job";

/** Mirrors the server's fold ("Wipe surfaces " ≡ "wipe surfaces") so refusal items land on the right row. */
function fold(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Frozen items the partner has not ticked, in checklist order. Exact strings from `checklist`. */
export function missingChecklistItems(checklist: readonly string[], ticked: readonly string[]): string[] {
  const done = new Set(ticked);
  return checklist.filter((item) => !done.has(item));
}

export type ChecklistGate = {
  /** True when nothing is left to tick (an empty checklist is trivially complete). */
  allowed: boolean;
  /** Items still needed, in checklist order. */
  missing: string[];
  /** Short copy for the disabled Complete button; null when allowed. */
  hint: string | null;
};

export function canCompleteChecklist(checklist: readonly string[], ticked: readonly string[]): ChecklistGate {
  const missing = missingChecklistItems(checklist, ticked);
  if (missing.length === 0) return { allowed: true, missing, hint: null };
  return {
    allowed: false,
    missing,
    hint: `${CHECKLIST_INCOMPLETE_HINT} (${missing.length} of ${checklist.length} left)`,
  };
}

/** Toggle one item; only strings on the frozen checklist can ever be ticked. */
export function toggleChecklistItem(checklist: readonly string[], ticked: readonly string[], item: string): string[] {
  if (!checklist.includes(item)) return [...ticked];
  return ticked.includes(item) ? ticked.filter((t) => t !== item) : [...ticked, item];
}

export type CompleteBookingBody = {
  latitude?: number;
  longitude?: number;
  notes?: string;
  photos?: string[];
  /** Only the items the partner ticked, as exact frozen strings, in checklist order. Absent when the checklist is empty. */
  completedChecklist?: string[];
};

/**
 * The `/complete` request body. `completedChecklist` carries the ticked items in checklist order —
 * never anything the partner did not tick — and is omitted altogether when the service has no
 * checklist, so a booking without a quality policy sends the same body it always did.
 */
export function buildCompleteBookingBody(input: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  notes?: string;
  photos?: string[];
  checklist: readonly string[];
  ticked: readonly string[];
}): CompleteBookingBody {
  const body: CompleteBookingBody = {};
  if (typeof input.latitude === "number" && Number.isFinite(input.latitude)) body.latitude = input.latitude;
  if (typeof input.longitude === "number" && Number.isFinite(input.longitude)) body.longitude = input.longitude;
  if (input.notes) body.notes = input.notes;
  if (input.photos?.length) body.photos = input.photos;
  const submitted = completedChecklistFor(input.checklist, input.ticked);
  if (submitted) body.completedChecklist = submitted;
  return body;
}

/** The `completedChecklist` value for the wire, or `undefined` when the checklist is empty (key omitted). */
export function completedChecklistFor(checklist: readonly string[], ticked: readonly string[]): string[] | undefined {
  if (checklist.length === 0) return undefined;
  const done = new Set(ticked);
  return checklist.filter((item) => done.has(item));
}

export type ChecklistRefusal = {
  /** True only for `QUALITY_CHECKLIST_REQUIRED`; every other failure is left to the generic handler. */
  checklistRefused: boolean;
  /** What to show the partner. */
  message: string;
  /**
   * Frozen checklist rows to mark as still needed — the server's `missingChecklistItems` resolved
   * onto exact `checklist` strings. When the server named nothing usable (history not yet visible,
   * verdict tables not deployed), every item is treated as still needed: the safe direction.
   */
  stillNeeded: string[];
};

/**
 * Map a `/complete` failure onto the checklist UI. `serverMissing` is the last quality-history
 * entry's `missingChecklistItems` (fetched after the refusal); it may be absent when that lookup failed.
 */
export function describeChecklistRefusal(
  code: string | null | undefined,
  message: string | null | undefined,
  checklist: readonly string[],
  serverMissing?: readonly string[] | null,
): ChecklistRefusal {
  if (code !== QUALITY_CHECKLIST_REQUIRED) {
    return { checklistRefused: false, message: message || "Complete failed", stillNeeded: [] };
  }
  const named = new Set((serverMissing ?? []).map(fold));
  const resolved = named.size ? checklist.filter((item) => named.has(fold(item))) : [];
  const stillNeeded = resolved.length ? resolved : [...checklist];
  const detail = stillNeeded.length
    ? ` Still needed: ${stillNeeded.join(", ")}.`
    : "";
  return {
    checklistRefused: true,
    message: `The server refused completion — the service checklist is not complete.${detail}`,
    stillNeeded,
  };
}
