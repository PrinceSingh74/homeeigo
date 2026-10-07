/**
 * What the job screen draws from a booking and the server's answers. Pure: no React Native import
 * and no runtime import at all, so it runs under `node --test`.
 *
 * Nothing here decides anything the server decides. It arranges what arrived (the stage rail, the
 * photos by stage), words the closed states, and reads the refusal a server answer carries. The
 * two gates it mirrors (completion proof, the reason length) only stop a request the server would
 * refuse anyway, and both err on the side of sending.
 */

type Maybe<T> = T | null | undefined;

const lower = (v: Maybe<string>) => (v ?? "").toLowerCase();
const has = (v: Maybe<string>) => typeof v === "string" && v.length > 0;

/* ------------------------------------------------------------- stage rail */

export type JobRailStep = { key: "accepted" | "enRoute" | "arrived" | "started" | "completed"; label: string; note: string | null; state: "done" | "current" | "todo" };

export type JobRailInput = {
  status: Maybe<string>;
  enRouteAt?: Maybe<string>;
  arrivedAt?: Maybe<string>;
  startedAt?: Maybe<string>;
  completedAt?: Maybe<string>;
};

const HELD = new Set(["accepted", "assigned", "en_route", "in_progress", "completed"]);
const CLOSED_WITHOUT_WORK = new Set(["cancelled_by_user", "cancelled_by_provider", "rejected", "expired", "customer_no_show", "provider_no_show"]);

/**
 * Accepted → On the way → Arrived → Started → Completed, each with its time when the server sent
 * one. A stage is reached only on what the payload says NOW: `arrivedAt` back to null (a reschedule
 * or a reassignment) is "not arrived", whatever an older copy said. The last reached stage is the
 * current one; on a completed job every step is done; on a job closed without work the stages that
 * were reached stay ticked and none is current.
 *
 * There is no accept time on the partner's payload, so "Accepted" never shows one.
 */
export function jobRailSteps(job: JobRailInput, fmt: (iso: string) => string): JobRailStep[] {
  const status = lower(job.status);
  const closed = CLOSED_WITHOUT_WORK.has(status);
  const completed = status === "completed";
  const started = completed || status === "in_progress" || has(job.startedAt);
  // A closed job keeps the arrival that led to it (a no-show); a live one is arrived only by its own timestamp or a later stage.
  const arrived = has(job.arrivedAt) || started;
  const enRoute = arrived || status === "en_route" || has(job.enRouteAt);
  const accepted = enRoute || HELD.has(status);

  const reached: Array<[JobRailStep["key"], string, boolean, Maybe<string>]> = [
    ["accepted", "Accepted", accepted, null],
    ["enRoute", "On the way", enRoute, job.enRouteAt],
    ["arrived", "Arrived", arrived, job.arrivedAt],
    ["started", "Started", started, job.startedAt],
    ["completed", "Completed", completed, job.completedAt],
  ];
  let lastReached = -1;
  reached.forEach(([, , done], i) => {
    if (done) lastReached = i;
  });
  return reached.map(([key, label, done, at], i) => ({
    key,
    label,
    note: done && has(at) ? fmt(at as string) : null,
    state: !done ? "todo" : completed || closed || i < lastReached ? "done" : "current",
  }));
}

/* ------------------------------------------------------- which answer rules */

/**
 * The policy the buttons follow. The server's `/actions` answer is the authority — but only for the
 * booking it was computed from. The detail and `/actions` are two requests, and a change pushed to
 * one (a reschedule clears the arrival) can land before the other is read again: then the cached
 * answer still says "Start job" for a job the screen already shows as not arrived. So the server's
 * answer is used while its `stage` is the stage of the booking on screen; when they differ the
 * local mirror (computed from that booking) is shown and the caller asks `/actions` again.
 */
export function pickJobPolicy<S extends { stage: string }, M extends { stage: string }>(server: S | null | undefined, mirror: M): { policy: S | M; source: "server" | "mirror"; stale: boolean } {
  if (!server) return { policy: mirror, source: "mirror", stale: false };
  if (server.stage === mirror.stage) return { policy: server, source: "server", stale: false };
  return { policy: mirror, source: "mirror", stale: true };
}

/* ----------------------------------------------------------- closed states */

export type JobTerminalSummary = { title: string; message: string; tone: "info" | "warning" | "success" };

/**
 * The plain summary of a job that ended. `cancellationReason` is the partner's OWN reason (the
 * server never sends anyone else's words), shown only on the partner's own cancel.
 */
export function jobTerminalSummary(status: Maybe<string>, cancellationReason?: Maybe<string>): JobTerminalSummary | null {
  switch (lower(status)) {
    case "completed":
      return { title: "Job completed", message: "This job is finished.", tone: "success" };
    case "cancelled_by_user":
      return { title: "Cancelled by the customer", message: "The customer cancelled this job. Nothing more is needed from you.", tone: "info" };
    case "cancelled_by_provider": {
      const reason = typeof cancellationReason === "string" ? cancellationReason.trim() : "";
      return { title: "You cancelled this job", message: reason ? `Your reason: ${reason}` : "This job was cancelled from your side.", tone: "info" };
    }
    case "rejected":
      return { title: "You declined this job", message: "It has been offered to another partner.", tone: "info" };
    case "expired":
      return { title: "This job expired", message: "The booking was not confirmed in time, so the slot was released. There is no visit to make.", tone: "info" };
    case "customer_no_show":
      return { title: "Customer was not available", message: "This job was closed because the customer was not available at the address.", tone: "warning" };
    case "provider_no_show":
      return { title: "Missed visit", message: "This job was closed because the visit did not happen.", tone: "warning" };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ cancel */

const CANCELLABLE_STAGES = new Set(["ACCEPTED", "EN_ROUTE", "ARRIVED", "STARTED", "IN_PROGRESS"]);

/**
 * Whether the partner's own cancel is offered. The server lists no CANCEL action (`availableActions`
 * has none): its rule is the route's — the partner who holds the job may cancel up to and including
 * IN_PROGRESS. So the control follows the SERVER's stage from `/actions` when it has answered, and
 * is not shown before that answer, on an offer (that is "Decline") or on anything closed.
 */
export function canPartnerCancel(input: { status: Maybe<string>; serverStage: Maybe<string> }): boolean {
  const status = lower(input.status);
  if (!["accepted", "assigned", "en_route", "in_progress"].includes(status)) return false;
  return typeof input.serverStage === "string" && CANCELLABLE_STAGES.has(input.serverStage.toUpperCase());
}

export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** The 3–500 character reason both `/cancel` and `/reject` ask for. Trimmed before counting. */
export function reasonState(text: string): { value: string; valid: boolean; hint: string | null } {
  const value = text.trim();
  if (value.length < REASON_MIN) return { value, valid: false, hint: `Write at least ${REASON_MIN} characters.` };
  if (value.length > REASON_MAX) return { value, valid: false, hint: `Keep it under ${REASON_MAX} characters.` };
  return { value, valid: true, hint: null };
}

/* ---------------------------------------------------------- server refusals */

type ApiErrorLike = { name?: unknown; code?: unknown; status?: unknown; message?: unknown; data?: unknown };

function apiError(error: unknown): ApiErrorLike | null {
  if (!(error instanceof Error) || error.name !== "PartnerApiError") return null;
  return error as ApiErrorLike;
}

/** The server's machine code on a refusal, or null (not an API error, or no code sent). */
export function refusalCode(error: unknown): string | null {
  const e = apiError(error);
  return e && typeof e.code === "string" ? e.code : null;
}

/** No HTTP answer at all: offline, DNS, TLS, timeout. Nothing the server said. */
export function isOfflineError(error: unknown): boolean {
  const e = apiError(error);
  return !!e && e.status === 0 && e.code === "NETWORK_ERROR";
}

export const OFFLINE_SENTENCE = "You're offline. Check your connection and try again.";

/** The sentence to show for a failure: offline in the app's words, otherwise the server's own. */
export function failureSentence(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (isOfflineError(error)) return OFFLINE_SENTENCE;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Position refusals of arrive / start / the on-site check (P0-6, P0-6b). */
export const LOCATION_REFUSAL_CODES = ["LOCATION_REQUIRED", "LOCATION_INVALID", "OUTSIDE_SERVICE_AREA", "LOCATION_UNCONFIRMED", "LOCATION_MISMATCH"] as const;
export type LocationRefusalCode = (typeof LOCATION_REFUSAL_CODES)[number];

export type LocationRefusal = {
  code: LocationRefusalCode;
  /** The server's sentence, unchanged. */
  message: string;
  /**
   * Whether "Turn on location" can help: the phone sent no position, or the server holds no recent
   * one. Not offered when the server HAS a position and it is somewhere else — a setting cannot
   * change where the partner is.
   */
  offerLocationSettings: boolean;
};

/**
 * Reads a position refusal out of a failed arrive / start / check. `sentWithoutFix` is whether the
 * request carried `null` coordinates. Null for any other failure.
 */
export function locationRefusal(error: unknown, sentWithoutFix: boolean): LocationRefusal | null {
  const code = refusalCode(error);
  if (!code || !(LOCATION_REFUSAL_CODES as readonly string[]).includes(code)) return null;
  const message = error instanceof Error && error.message ? error.message : "";
  const needsPosition = code === "LOCATION_REQUIRED" || code === "LOCATION_INVALID" || code === "LOCATION_UNCONFIRMED";
  return { code: code as LocationRefusalCode, message, offerLocationSettings: sentWithoutFix || needsPosition };
}

function dataNumber(error: unknown, key: string): number | null {
  const e = apiError(error);
  const data = e && typeof e.data === "object" && e.data !== null ? (e.data as Record<string, unknown>) : null;
  const v = data ? data[key] : undefined;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export type StartPinFailure = {
  /** The server's sentence, or the offline sentence. */
  message: string;
  kind: "INVALID" | "EXPIRED" | "LOCKED" | "NOT_REQUESTED" | "OTHER";
  /** From `data.attemptsLeft`; a number only when the server sent one (OTP_INVALID). */
  attemptsLeft: number | null;
  /** The PIN that was typed cannot be tried again: a new one has to be sent. */
  needsNewPin: boolean;
};

/** A failed `POST /bookings/:id/start`, as the PIN sheet shows it. */
export function startPinFailure(error: unknown): StartPinFailure {
  const code = refusalCode(error);
  const kind: StartPinFailure["kind"] =
    code === "OTP_INVALID" ? "INVALID" : code === "OTP_EXPIRED" ? "EXPIRED" : code === "OTP_LOCKED" ? "LOCKED" : code === "OTP_NOT_REQUESTED" || code === "OTP_REQUIRED" ? "NOT_REQUESTED" : "OTHER";
  return {
    message: failureSentence(error, "The job could not be started. Please try again."),
    kind,
    attemptsLeft: kind === "INVALID" ? dataNumber(error, "attemptsLeft") : null,
    needsNewPin: kind === "EXPIRED" || kind === "LOCKED" || kind === "NOT_REQUESTED",
  };
}

/** "2 attempts left" / "1 attempt left"; null when the server sent no count. */
export function attemptsLeftText(attemptsLeft: number | null): string | null {
  if (attemptsLeft === null || attemptsLeft < 0) return null;
  return `${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left`;
}

/**
 * Seconds to wait before another PIN can be sent, from a refused `POST /start-otp`
 * (`data.retryAfterSec` on RESEND_COOLDOWN / RATE_LIMITED, else the top-level `retryAfter`).
 * Null when the server named no wait — never a guessed number.
 */
export function pinResendWait(error: unknown): number | null {
  const fromData = dataNumber(error, "retryAfterSec");
  if (fromData !== null && fromData > 0) return Math.ceil(fromData);
  const e = apiError(error) as (ApiErrorLike & { retryAfter?: unknown }) | null;
  const top = e?.retryAfter;
  return typeof top === "number" && Number.isFinite(top) && top > 0 ? Math.ceil(top) : null;
}

/** "Send PIN" before any PIN went out, "Resend in N s" while the server's wait runs, then "Resend PIN". */
export function pinSendLabel(sentOnce: boolean, waitSeconds: number): string {
  if (waitSeconds > 0) return `Resend in ${waitSeconds} s`;
  return sentOnce ? "Resend PIN" : "Send PIN";
}

/* ------------------------------------------------------------------ photos */

export type PhotoStage = "ARRIVAL" | "START" | "COMPLETION";
export const PHOTO_STAGES: readonly PhotoStage[] = ["ARRIVAL", "START", "COMPLETION"];
export const PHOTO_STAGE_LABEL: Record<PhotoStage, string> = { ARRIVAL: "Arrival", START: "Start", COMPLETION: "Completion" };

type EvidenceRowLike = { id: string; stage: string; isCurrent: boolean; mediaAccessUrl: Maybe<string>; capturedAt: string };

/**
 * The job's photos by stage, in stage order. Only rows that hold a photo and are current are
 * listed: the server also keeps position stamps and replaced photos, which are not pictures to show.
 */
export function photosByStage<T extends EvidenceRowLike>(rows: readonly T[] | null | undefined): Array<{ stage: PhotoStage; label: string; photos: T[] }> {
  return PHOTO_STAGES.map((stage) => ({
    stage,
    label: PHOTO_STAGE_LABEL[stage],
    photos: (rows ?? []).filter((r) => String(r.stage).toUpperCase() === stage && r.isCurrent && has(r.mediaAccessUrl)),
  }));
}

/**
 * Which stages take a new photo now, by the SERVER's stage. Before the work starts a photo is an
 * arrival photo (the door photo of a no-show is one); once it has started, a "before" photo goes to
 * START and the finished work to COMPLETION — which is sent with the completion itself.
 */
export function photoStagesOpen(serverStage: Maybe<string>): PhotoStage[] {
  switch ((serverStage ?? "").toUpperCase()) {
    case "ACCEPTED":
    case "EN_ROUTE":
    case "ARRIVED":
      return ["ARRIVAL"];
    case "STARTED":
    case "IN_PROGRESS":
      return ["START", "COMPLETION"];
    default:
      return [];
  }
}

export type CompletionProof = {
  /** The frozen quality policy asks for photos. */
  required: boolean;
  /** Complete may be sent. Always true when nothing is required or the photos cannot be counted. */
  ready: boolean;
  /** What the Complete button says while not ready; also the line shown beside the photo control. */
  hint: string | null;
  /** The line shown beside the completion photo control whether or not it is satisfied. */
  ask: string;
};

export const PROOF_PHOTO_HINT = "Add a completion photo first. This service needs photo proof.";
export const PROOF_BEFORE_AFTER_HINT = "This service needs a before photo and a completion photo.";

/**
 * Mirror of the server's proof rule (backend `qualityBlocksCompletion` + `resolveQualityEvidence`):
 * `beforeAfterPhotos` needs a stored photo at ARRIVAL or START and one at COMPLETION; `proofRequired`
 * needs at least one stored photo. A photo staged to travel with `/complete` counts as a COMPLETION
 * photo. `evidence: null` means the list has not loaded: then nothing is blocked here and the server
 * decides — this gate must never stop a completion the server would accept.
 */
export function completionProof(
  quality: Maybe<{ proofRequired?: Maybe<boolean>; beforeAfterPhotos?: Maybe<boolean> }>,
  evidence: readonly { stage: string; mediaAccessUrl: Maybe<string> }[] | null | undefined,
  stagedCompletionPhotos: number,
): CompletionProof {
  const beforeAfter = quality?.beforeAfterPhotos === true;
  const proof = quality?.proofRequired === true;
  const required = beforeAfter || proof;
  const ask = beforeAfter
    ? "Before and after photos are required for this job."
    : proof
      ? "A photo of the finished work is required for this job."
      : "Add a photo of the finished work. It is sent when you complete the job.";
  if (!required || evidence == null) return { required, ready: true, hint: null, ask };
  const stored = evidence.filter((r) => has(r.mediaAccessUrl));
  const before = stored.some((r) => ["ARRIVAL", "START"].includes(String(r.stage).toUpperCase()));
  const after = stagedCompletionPhotos > 0 || stored.some((r) => String(r.stage).toUpperCase() === "COMPLETION");
  if (beforeAfter && !(before && after)) {
    const hint = !before && !after ? PROOF_BEFORE_AFTER_HINT : !before ? "Add a before photo first (under Photos, Start)." : PROOF_PHOTO_HINT;
    return { required, ready: false, hint, ask };
  }
  if (proof && stored.length + stagedCompletionPhotos < 1) return { required, ready: false, hint: PROOF_PHOTO_HINT, ask };
  return { required, ready: true, hint: null, ask };
}

/* -------------------------------------------------------------------- chat */

export type ChatBubble = { mine: boolean; /** Shown under the partner's own messages only. */ receipt: "Read" | "Delivered" | "Sent" | null };

/** Whose message it is and how far it got, from the fields the server sends — nothing inferred. */
export function chatBubble(message: { senderUserId: string; deliveredAt: Maybe<string>; readAt: Maybe<string> }, myUserId: Maybe<string>): ChatBubble {
  const mine = has(myUserId) && message.senderUserId === myUserId;
  if (!mine) return { mine: false, receipt: null };
  return { mine: true, receipt: has(message.readAt) ? "Read" : has(message.deliveredAt) ? "Delivered" : "Sent" };
}

/* -------------------------------------------------------------------- maps */

/**
 * The link "Open in Maps" opens: directions to the booking's own coordinates when the server sent
 * them (only while the job is active), else a search for the address text it sent. Null when the
 * payload carries neither — nothing is searched for on a guess.
 */
export function mapsUrl(address: Maybe<{ latitude?: Maybe<number>; longitude?: Maybe<number>; fullAddress?: Maybe<string> }>): string | null {
  if (!address) return null;
  const { latitude, longitude } = address;
  const real = typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0);
  if (real) return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  const text = typeof address.fullAddress === "string" ? address.fullAddress.trim() : "";
  return text ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}` : null;
}

/* ------------------------------------------------------------ requirements */

type GateLike = { ok: boolean; blocking: ReadonlyArray<{ label: string; remediation: { text: string } }> };

/** The requirement gate an arrival answer carries, as lines to read at the door (the server's words). */
export function arrivalGateLines(gate: Maybe<GateLike>): string[] {
  if (!gate || gate.ok) return [];
  return gate.blocking.map((b) => (b.remediation?.text ? `${b.label}: ${b.remediation.text}` : b.label));
}
