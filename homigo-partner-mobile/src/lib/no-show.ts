import type { NoShowPreview, NoShowReportResult } from "@/types/partner";

/**
 * "Customer not available" — what the job screen shows for a given server answer and moment.
 * Ported from apps/partner-web/src/lib/no-show.ts. Pure: no React Native import.
 *
 * The server owns every decision here (`noShow` on `GET /api/bookings/:id/actions`): whether the
 * wait has been served, whether the fee applies, and the sentence that explains it. This module
 * only counts the minutes down between two answers and picks which controls to show. It never
 * opens the report on the local clock: at zero it asks the server again.
 */

/** An answer younger than this is not asked for again — the guard against a refetch loop at zero. */
export const NO_SHOW_REFETCH_FLOOR_MS = 5_000;

export type NoShowView = {
  /** The server's sentence, untouched. */
  message: string;
  /** Only ever the server's `canReport`. */
  canReport: boolean;
  /** Whole minutes left, counted down from the answer; null when the server could not measure the wait. */
  minutesLeft: number | null;
  waitLabel: string;
  /** The countdown reached zero on an answer that still says "not yet": fetch a new one. */
  shouldRefetch: boolean;
  /** ADDED: on record. NEEDED: ask for it. NOT_ASKED: a photo would not change the server's answer. */
  doorPhoto: "ADDED" | "NEEDED" | "NOT_ASKED";
};

/**
 * Whole minutes in the unit a person reads them in: minutes up to an hour and a half, then hours,
 * then days. A partner who arrives long before the booked time is otherwise shown "23975 min".
 */
function waitInWords(minutes: number): string {
  if (minutes < 90) return `${minutes} min`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return [`${days} ${days === 1 ? "day" : "days"}`, hours > 0 ? `${hours} hr` : ""].filter(Boolean).join(" ");
  return [`${hours} hr`, mins > 0 ? `${mins} min` : ""].filter(Boolean).join(" ");
}

/**
 * @param fetchedAtMs when the `/actions` answer carrying `preview` arrived (React Query `dataUpdatedAt`)
 * @param nowMs       the current time on the same clock
 */
export function noShowView(preview: NoShowPreview, fetchedAtMs: number, nowMs: number): NoShowView {
  const elapsedMs = Math.max(0, nowMs - fetchedAtMs);
  const minutesLeft =
    preview.minutesLeft === null ? null : preview.canReport ? 0 : Math.max(0, preview.minutesLeft - Math.floor(elapsedMs / 60_000));
  const shouldRefetch = !preview.canReport && minutesLeft === 0 && elapsedMs >= NO_SHOW_REFETCH_FLOOR_MS;
  const waitLabel = preview.canReport
    ? "You can report now"
    : minutesLeft === null
      ? "Not available yet"
      : minutesLeft === 0
        ? "Checking the wait…"
        : `You can report in ${waitInWords(minutesLeft)}`;
  return {
    message: preview.message,
    canReport: preview.canReport,
    minutesLeft,
    waitLabel,
    shouldRefetch,
    doorPhoto: preview.hasDoorPhoto ? "ADDED" : preview.reason === "NO_DOOR_PHOTO" ? "NEEDED" : "NOT_ASKED",
  };
}

/** One id per picked photo: the server answers a repeated id with the row it already has. */
export const doorPhotoUploadId = (nowMs: number) => `m-door-${nowMs}`;

export type NoShowResultView = {
  message: string;
  /** The server's explanation when no fee was taken. */
  feeNote: string | null;
  /** The fee the server says it recorded, when it took one. */
  feeRecorded: number | null;
};

export function noShowResultView(result: NoShowReportResult): NoShowResultView {
  return {
    message: result.message,
    feeNote: result.feeNote ?? null,
    feeRecorded: result.feeAmount > 0 ? result.feeAmount : null,
  };
}
