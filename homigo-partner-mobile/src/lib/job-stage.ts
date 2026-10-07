/**
 * Which copy of a job the screen shows, and what its status lets the partner read.
 * Pure: no React Native import, no React Query import (the screen passes plain values in).
 *
 * THE RULE: the fresh detail response (`GET /api/bookings/:id`) is authoritative.
 *
 *  - It is shown exactly as sent. No timestamp is carried forward from an older copy: the server
 *    takes stages back (a reschedule clears `arrivedAt`; a cancel, an expiry or a no-show closes a job
 *    that still carries its arrival).
 *  - A 404 means the job is no longer this partner's (reassigned, or an offer that lapsed): nothing is
 *    shown and any optimistic copy is dropped. The server answers 404 — not 403 — to a displaced
 *    partner (`booking.service.ts` access rule).
 *  - An optimistic copy written by a mutation is shown ONLY while that mutation is in flight. Keep the
 *    mutation pending until the detail refetch has landed (React Query: `onSuccess: () =>
 *    queryClient.invalidateQueries({ queryKey: detailKey })` — returning the promise keeps
 *    `isPending` true), so the screen goes straight from the optimistic copy to the server's.
 *  - A list row is a first-paint placeholder, used only until the detail has answered once.
 *
 * This replaces the job screen's module-level `stageHold` / "most advanced copy" merge, which could
 * never show a stage going back.
 */

/** Statuses are compared case-insensitively: the wire form is lowercase, the enum uppercase. */
const lower = (status: string | null | undefined) => (status ?? "").toLowerCase();

export type JobDetailRead<T> =
  /** The detail endpoint answered with this booking (the latest successful response). */
  | { kind: "data"; booking: T }
  /** The detail endpoint answered 404: not this partner's job (any more). */
  | { kind: "gone" }
  /** No answer yet (loading), or it failed without ever having answered. */
  | { kind: "none" };

export type JobHold<T> = {
  /** The optimistic copy a mutation wrote, or null. */
  booking: T | null;
  /** True while that mutation (including its awaited detail refetch) is pending. */
  inFlight: boolean;
};

export type ResolvedJob<T> = {
  booking: T | null;
  source: "detail" | "held" | "list" | "none";
  /** The detail endpoint says this job is not the partner's: show "no longer assigned to you". */
  gone: boolean;
  /** The caller must discard its optimistic copy now. */
  clearHold: boolean;
};

export function resolveJobBooking<T extends { id: string }>(input: {
  detail: JobDetailRead<T>;
  /** The same booking from a list cache, for first paint only. */
  listRow: T | null | undefined;
  hold: JobHold<T>;
}): ResolvedJob<T> {
  const { detail, hold } = input;
  const held = hold.booking;
  if (detail.kind === "gone") return { booking: null, source: "none", gone: true, clearHold: held != null };

  const shown = detail.kind === "data" ? detail.booking : (input.listRow ?? null);
  const holdApplies = held != null && hold.inFlight && (shown == null || held.id === shown.id);
  if (holdApplies) return { booking: held, source: "held", gone: false, clearHold: false };

  const clearHold = held != null;
  if (detail.kind === "data") return { booking: detail.booking, source: "detail", gone: false, clearHold };
  if (shown) return { booking: shown, source: "list", gone: false, clearHold };
  return { booking: null, source: "none", gone: false, clearHold };
}

/** The server's "not yours / does not exist" answer. A network failure or a 5xx is NOT this. */
export function isJobGoneError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "PartnerApiError") return false;
  return (error as { status?: unknown }).status === 404;
}

/**
 * Turns the detail query's state into a `JobDetailRead`. A 404 wins over data kept from an earlier
 * success; any other failure (offline, 5xx) keeps showing the last successful answer.
 */
export function detailReadOf<T>(query: { data: T | undefined; error: unknown }): JobDetailRead<T> {
  if (isJobGoneError(query.error)) return { kind: "gone" };
  if (query.data !== undefined) return { kind: "data", booking: query.data };
  return { kind: "none" };
}

export type StagePatch = Partial<{ status: string; enRouteAt: string; arrivedAt: string; startedAt: string; completedAt: string }>;

/**
 * What a lifecycle action itself sets, for the optimistic copy shown while its request is in flight.
 * Arrival does not change `status` (it is a timestamp). `null` for actions that set no stage field —
 * a no-show report in particular is never shown optimistically: the server decides its outcome.
 */
export function optimisticStagePatch(action: string, atIso: string): StagePatch | null {
  switch (action) {
    case "ACCEPT":
      return { status: "accepted" };
    case "START_NAVIGATION":
      return { status: "en_route", enRouteAt: atIso };
    case "MARK_ARRIVED":
      return { arrivedAt: atIso };
    case "START_SERVICE":
      return { status: "in_progress", startedAt: atIso };
    case "COMPLETE_SERVICE":
      return { status: "completed", completedAt: atIso };
    default:
      return null;
  }
}

/* ---- what a status lets the partner read (ported from apps/partner-web/src/lib/job-stage.ts) ----
 *
 * The server scopes the job to the partner who HOLDS it:
 *  - an OFFER (status `pending`) is not held yet: `/actions`, `/requirements`, `/execution`, `/safety`,
 *    `/quality`, `/completion` answer 404 and `/evidence` an empty list, by design — the booking
 *    payload itself carries the brief an offer needs;
 *  - chat exists only while the job is active: outside it the chat routes answer 403 `CHAT_CLOSED`.
 */
export const ACTIVE_JOB_STATUSES = ["accepted", "assigned", "en_route", "in_progress"] as const;

/** The partner holds the job and it is not finished. Unknown or missing statuses are not active. */
export function isActiveJobStatus(status: string | null | undefined): boolean {
  return (ACTIVE_JOB_STATUSES as readonly string[]).includes(lower(status));
}

/** The partner has been offered the job and has not accepted it. */
export function isOfferStatus(status: string | null | undefined): boolean {
  return lower(status) === "pending";
}

export type JobSubResource = "actions" | "requirements" | "execution" | "safety" | "quality" | "completion" | "evidence";

const JOB_SUB_RESOURCES: readonly JobSubResource[] = ["actions", "requirements", "execution", "safety", "quality", "completion", "evidence"];

/**
 * Which `/api/bookings/:id/<sub-resource>` reads may fire for a status. None for an offer and none
 * before the status is known; all of them once the partner holds (or held) the job.
 */
export function jobSubResourcesEnabled(status: string | null | undefined): Record<JobSubResource, boolean> {
  const held = !!status && !isOfferStatus(status);
  return Object.fromEntries(JOB_SUB_RESOURCES.map((k) => [k, held])) as Record<JobSubResource, boolean>;
}

export const CHAT_CLOSED_MESSAGE = "Chat is closed for this job.";

/** Chat may be read, marked read and written only while the job is active. */
export function isChatOpen(status: string | null | undefined): boolean {
  return isActiveJobStatus(status);
}

/** The server's own refusal (403 `CHAT_CLOSED`) — e.g. the job ended while the panel was open. */
export function isChatClosedError(error: unknown): boolean {
  return error instanceof Error && error.name === "PartnerApiError" && (error as { code?: unknown }).code === "CHAT_CLOSED";
}
