/**
 * The service quality checklist a partner must submit with "Mark complete".
 *
 * Server contract (apps/backend, not imported — mirrored by hand like every other wire type here):
 *
 *   GET  /api/bookings/:id            → data.booking.execution.quality.checklist: string[]
 *                                        (the FROZEN checklist of THIS booking; `execution` is the
 *                                        partner projection, `quality` is null when the service has
 *                                        no quality policy)
 *   POST /api/bookings/:id/complete   ← body.completedChecklist?: string[]
 *                                        matched ITEM BY ITEM (exact strings) against the frozen
 *                                        checklist; a missing item refuses with 409 and
 *                                        { code: "QUALITY_CHECKLIST_REQUIRED", data: { verdictId } }
 *   GET  /api/bookings/:id/quality    → data.history[last].missingChecklistItems: string[]
 *
 * Everything in this file is pure so `bun test tests` can pin it: which items are still missing,
 * whether the client may even offer "Mark complete", what goes on the wire, and how a refusal is
 * explained. The server stays the authority — a client that thinks it is allowed is only allowed
 * to ASK.
 */

export const QUALITY_CHECKLIST_REQUIRED = "QUALITY_CHECKLIST_REQUIRED";

/** What the partner UI needs from `GET /api/bookings/:id` → `booking.execution.quality`. */
export type BookingExecutionQuality = {
  checklist: string[];
  proofRequired: boolean;
  beforeAfterPhotos: boolean;
};

export const EMPTY_EXECUTION_QUALITY: BookingExecutionQuality = Object.freeze({
  checklist: [],
  proofRequired: false,
  beforeAfterPhotos: false,
}) as BookingExecutionQuality;

/**
 * Reads the quality block out of a `GET /api/bookings/:id` response body, tolerating every way it
 * can be absent (no `execution` for a customer projection, `quality: null` for a service without a
 * quality policy, a malformed checklist). Item strings are kept EXACTLY — the server matches them
 * byte for byte, so no trimming or de-duplication here.
 */
export function parseExecutionQuality(raw: unknown): BookingExecutionQuality {
  const booking = pick(pick(raw, "data"), "booking") ?? pick(raw, "booking") ?? raw;
  const quality = pick(pick(booking, "execution"), "quality");
  if (!quality || typeof quality !== "object") return EMPTY_EXECUTION_QUALITY;
  const q = quality as Record<string, unknown>;
  const checklist = Array.isArray(q.checklist)
    ? q.checklist.filter((x): x is string => typeof x === "string")
    : [];
  return {
    checklist,
    proofRequired: q.proofRequired === true,
    beforeAfterPhotos: q.beforeAfterPhotos === true,
  };
}

export type ExecutionPolicyCopy = { materials: string | null; equipment: string | null };

/**
 * X-30: the booking's FROZEN materials / equipment policy sentences (`GET /api/bookings/:id` →
 * execution.materials / execution.equipment), shown to the partner as the server wrote them. Anything
 * absent or not a non-empty string is null — the page then shows nothing rather than a guess.
 */
export function parseExecutionPolicyCopy(raw: unknown): ExecutionPolicyCopy {
  const booking = pick(pick(raw, "data"), "booking") ?? pick(raw, "booking") ?? raw;
  const execution = pick(booking, "execution");
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return { materials: text(pick(execution, "materials")), equipment: text(pick(execution, "equipment")) };
}

function pick(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>)[key] : undefined;
}

/** Items of the frozen checklist that are not ticked, in checklist order. */
export function missingChecklistItems(checklist: readonly string[], ticked: Iterable<string>): string[] {
  const done = ticked instanceof Set ? ticked : new Set(ticked);
  return checklist.filter((item) => !done.has(item));
}

export type CompletionGate = {
  /** May the client offer "Mark complete"? (The server decides again on submit.) */
  allowed: boolean;
  /** Unticked items, in checklist order. Empty when allowed. */
  missing: string[];
  /** Why the button is disabled — null when allowed. */
  hint: string | null;
};

/** Whether the client may ASK for completion, and the sentence shown next to a disabled button. */
export function completionGate(checklist: readonly string[], ticked: Iterable<string>): CompletionGate {
  const missing = missingChecklistItems(checklist, ticked);
  if (missing.length === 0) return { allowed: true, missing, hint: null };
  const n = missing.length;
  return {
    allowed: false,
    missing,
    hint:
      n === checklist.length
        ? `Tick every item of the service checklist (${n}) before marking this job complete.`
        : `${n} checklist item${n === 1 ? "" : "s"} still ${n === 1 ? "needs" : "need"} to be ticked before marking this job complete.`,
  };
}

/**
 * The `completedChecklist` value for the complete request: ONLY ticked items, as the exact strings
 * of the frozen checklist, in checklist order. `undefined` (no key on the wire) when the booking
 * has no checklist — the server then has nothing to match and a missing key is the honest shape.
 * A tick for a string that is not on the checklist is dropped: the client never claims work the
 * booking did not ask for.
 */
export function buildCompletedChecklist(checklist: readonly string[], ticked: Iterable<string>): string[] | undefined {
  if (checklist.length === 0) return undefined;
  const done = ticked instanceof Set ? ticked : new Set(ticked);
  return checklist.filter((item) => done.has(item));
}

/** Request-body fields the checklist contributes to `POST /api/bookings/:id/complete`. */
export function checklistCompletionFields(
  checklist: readonly string[],
  ticked: Iterable<string>,
): { completedChecklist?: string[] } {
  const completedChecklist = buildCompletedChecklist(checklist, ticked);
  return completedChecklist === undefined ? {} : { completedChecklist };
}

export type CompletionRefusal = {
  code: typeof QUALITY_CHECKLIST_REQUIRED;
  /** What the partner is told. */
  message: string;
  /** Where the checklist can actually be completed. */
  href: string;
  /** The §10 verdict row the refusal left behind, when the server sent one. */
  verdictId: number | null;
};

/**
 * Maps a failed complete call to something a surface WITHOUT a checklist (a list card, the dashboard)
 * can act on. Only `QUALITY_CHECKLIST_REQUIRED` is mapped; every other refusal keeps its own
 * message. `onJobPage` changes the sentence: on the job page the checklist is already in view, so
 * "go to the job page" would be nonsense there.
 */
export function describeCompletionRefusal(
  error: unknown,
  bookingId: string,
  opts: { onJobPage?: boolean } = {},
): CompletionRefusal | null {
  const code = pick(error, "code");
  if (code !== QUALITY_CHECKLIST_REQUIRED) return null;
  const verdictIdRaw = pick(pick(error, "data"), "verdictId");
  return {
    code: QUALITY_CHECKLIST_REQUIRED,
    message: opts.onJobPage
      ? "The server still reports the service checklist as incomplete. The items it needs are marked in the checklist above — tick them and try again."
      : "This service has a quality checklist that must be completed on the job page before the job can be marked complete.",
    href: `/requests/${encodeURIComponent(bookingId)}`,
    verdictId: typeof verdictIdRaw === "number" ? verdictIdRaw : null,
  };
}
