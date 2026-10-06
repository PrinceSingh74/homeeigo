import { PartnerApiError } from "@/lib/api-error";

/**
 * What a booking's status lets the partner read, in one place.
 *
 * The server scopes the job to the partner who HOLDS it. Two consequences the UI must follow rather
 * than discover by error:
 *  - an OFFER (status `pending`) is not held yet: its sub-resources answer 404 or an empty list by
 *    design, and the booking payload itself carries the brief an offer needs;
 *  - chat exists only while the job is active: outside it the chat routes answer 403 `CHAT_CLOSED`.
 */
export const ACTIVE_JOB_STATUSES = ["accepted", "assigned", "en_route", "in_progress"] as const;

/** The partner holds the job and it is not finished. Unknown or missing statuses are not active. */
export function isActiveJobStatus(status: string | null | undefined): boolean {
  return (ACTIVE_JOB_STATUSES as readonly string[]).includes(status ?? "");
}

/** The partner has been offered the job and has not accepted it. */
export function isOfferStatus(status: string | null | undefined): boolean {
  return status === "pending";
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
  return error instanceof PartnerApiError && error.code === "CHAT_CLOSED";
}
