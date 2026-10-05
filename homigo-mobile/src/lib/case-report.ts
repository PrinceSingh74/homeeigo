/**
 * Phase 10 §11 — what the customer is offered about reporting an issue, and the words for every
 * refusal the server can give. Pure: the server decides whether a report is possible
 * (`report` on GET /api/bookings/:id/cases); this only turns that answer into one UI decision.
 * The complaint window is never computed here.
 *
 * Mirrored in apps/web/src/lib/case-report.ts — change both together. The last section (a picked
 * photo → the upload part) exists only here: the website reads a File, this app reads a picker asset.
 */

/** Mirrored by hand from bookingCaseService.reportability. Absent on an older backend. */
export type CaseReportability = { canReport: boolean; reason: string | null; openCaseId: string | null };

/**
 * The server's refusals for POST /:id/cases (routes/booking-cases CASE_HTTP), in the customer's words.
 * `final` = retrying cannot help, so the action is withdrawn for this booking.
 */
export const REPORT_REFUSAL: Record<string, { message: string; final: boolean }> = {
  COMPLAINT_WINDOW_CLOSED: { message: "The time to report an issue on this booking has passed. If you still need help, please contact support.", final: true },
  COMPLAINT_WINDOW_NOT_CONFIGURED: { message: "This service doesn't take issue reports after completion. If you need help, please contact support.", final: true },
  BOOKING_NOT_COMPLETED: { message: "You can report an issue once the job is completed.", final: false },
  CASES_UNAVAILABLE: { message: "Issue reporting isn't available right now. Please try again in a little while.", final: false },
  INVALID_CATEGORY: { message: "Please choose what went wrong from the list.", final: false },
};

/** A reason code this client has no wording for (NOT_FOUND, or one added later). */
const REPORT_UNAVAILABLE = "Issue reporting isn't available for this booking. If you need help, please contact support.";

/** booking-case-policy TERMINAL_CASE_STATES. */
export const CLOSED_CASE_STATES: ReadonlySet<string> = new Set(["RESOLVED", "REJECTED"]);

export type ReportDecision =
  /** Show the report button. */
  | { kind: "offer"; label: "Report an issue" | "Report another issue" }
  /** No button: say why, in plain words. */
  | { kind: "reason"; message: string }
  /** A case is already open: point to it instead of offering a second report. */
  | { kind: "open_case"; caseId: string }
  /** Nothing to show (the open case is already described elsewhere on the card). */
  | { kind: "none" };

export type ReportDecisionInput = {
  /** `report` from GET /:id/cases. null / undefined = the server did not say (older backend, or still loading). */
  report: CaseReportability | null | undefined;
  /** completion.state from GET /:id/completion. */
  completionState: string | null | undefined;
  /** State of the newest case on the booking, when there is one. */
  latestCaseState: string | null | undefined;
  /** A refusal the server already gave to a report attempt in this session. */
  refusal: { message: string; final: boolean } | null | undefined;
};

export function reportDecision(input: ReportDecisionInput): ReportDecision {
  const hasEarlierCase = !!input.latestCaseState;
  const label = hasEarlierCase ? "Report another issue" : "Report an issue";

  // The server already refused for good in this session — that outranks an answer fetched earlier.
  if (input.refusal?.final) return { kind: "reason", message: input.refusal.message };

  const report = input.report;
  if (report) {
    if (report.openCaseId) return { kind: "open_case", caseId: report.openCaseId };
    if (report.canReport) return { kind: "offer", label };
    if (report.reason) return { kind: "reason", message: REPORT_REFUSAL[report.reason]?.message ?? REPORT_UNAVAILABLE };
    return { kind: "none" };
  }

  // The server did not say: offer the action and let its refusal be shown (the earlier behaviour).
  if (input.completionState === "ISSUE_REPORTED") {
    // An open case would only replay; a second report makes sense once the first is closed.
    return input.latestCaseState && CLOSED_CASE_STATES.has(input.latestCaseState) ? { kind: "offer", label } : { kind: "none" };
  }
  if (input.completionState === "PENDING_CUSTOMER" || input.completionState === "CONFIRMED" || input.completionState === "AUTO_CONFIRMED") {
    return { kind: "offer", label };
  }
  return { kind: "none" };
}

/** What a failed report attempt becomes: known codes in our words, otherwise the server's message. */
export function reportRefusal(code: string | null | undefined, serverMessage: string | null | undefined): { message: string; final: boolean } {
  const known = code ? REPORT_REFUSAL[code] : undefined;
  return known ?? { message: serverMessage?.trim() || "Could not report this issue. Please try again.", final: false };
}

/* ------------------------------------------------------------------ */
/* Photo evidence                                                      */
/* ------------------------------------------------------------------ */

/** Same limit as routes/booking-cases MAX_CASE_PHOTO_BYTES. The server re-checks; this only saves an upload. */
export const MAX_CASE_PHOTO_BYTES = 8 * 1024 * 1024;
export const CASE_PHOTO_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];
export const CASE_PHOTO_ACCEPT = CASE_PHOTO_TYPES.join(",");

/** null = fine to send. The server decides the real type from the bytes. */
export function casePhotoProblem(file: { size: number; type: string }): string | null {
  if (file.type && !CASE_PHOTO_TYPES.includes(file.type)) return "Please choose a JPG, PNG or WEBP photo.";
  if (file.size > MAX_CASE_PHOTO_BYTES) return "That photo is larger than 8 MB. Please choose a smaller one.";
  if (file.size <= 0) return "That file is empty. Please choose another photo.";
  return null;
}

/** The server's refusals for POST /:id/cases/:caseId/evidence/photo, in the customer's words. */
const PHOTO_REFUSAL: Record<string, string> = {
  VALIDATION_ERROR: "That photo couldn't be used. Please choose a JPG, PNG or WEBP photo of up to 8 MB.",
  CASE_NOT_FOUND: "We couldn't find this case. Please reopen the booking and try again.",
  CASE_CLOSED: "This case is closed, so it can't take more photos.",
  EVIDENCE_LIMIT: "This case already has the maximum number of notes and photos.",
  CASES_UNAVAILABLE: "Issue reporting isn't available right now. Please try again in a little while.",
};

export function casePhotoError(code: string | null | undefined): string {
  return (code && PHOTO_REFUSAL[code]) || "The photo couldn't be added. Please try again.";
}

/* ------------------------------------------------------------------ */
/* Picked photo → upload part (this app only; the website reads a File) */
/* ------------------------------------------------------------------ */

/** What the image picker reports about one photo. Everything but the uri may be missing. */
export type PickedPhoto = { uri: string; mimeType?: string | null; fileName?: string | null; fileSize?: number | null };

/** The `file` part of the multipart upload, in the shape React Native's FormData takes. */
export type CasePhotoPart = { uri: string; name: string; type: string };

const EXT_TYPE: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const TYPE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function extensionOf(value: string | null | undefined): string | null {
  const m = /\.([a-z0-9]{1,5})(?:[?#].*)?$/i.exec(value ?? "");
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Accept or refuse a picked photo before any upload, and name the part.
 * Type: the picker's own MIME type when it gives one, else the file extension; a type the server
 * would refuse (HEIC, a video) is refused here. When nothing is known the photo is sent as JPEG
 * and the server, which reads the bytes, decides. The device's file name is never sent.
 */
export function casePhotoPart(photo: PickedPhoto): { ok: true; file: CasePhotoPart } | { ok: false; message: string } {
  if (!photo.uri) return { ok: false, message: "That photo couldn't be read. Please choose another one." };
  const declared = photo.mimeType?.trim().toLowerCase().replace("image/jpg", "image/jpeg") || null;
  const ext = extensionOf(photo.fileName) ?? extensionOf(photo.uri);
  const type = declared ?? (ext ? (EXT_TYPE[ext] ?? `unknown/${ext}`) : "image/jpeg");
  const size = typeof photo.fileSize === "number" && photo.fileSize > 0 ? photo.fileSize : null;
  // The size is checked only when the picker reported one; the server enforces the limit either way.
  const problem = casePhotoProblem({ size: size ?? 1, type });
  if (problem) return { ok: false, message: problem };
  return { ok: true, file: { uri: photo.uri, name: `case-photo.${TYPE_EXT[type] ?? "jpg"}`, type } };
}

/** Said when the customer refuses the permission the chosen route needs. */
export function casePhotoPermissionMessage(source: "camera" | "library"): string {
  return source === "camera"
    ? "Homeeigo can't use the camera without your permission. Choose a photo from your library instead, or allow Camera in Settings."
    : "Homeeigo can't open your photos without your permission. Take a photo instead, or allow Photos in Settings.";
}
