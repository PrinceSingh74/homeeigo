import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { isPendingStatus } from "@/lib/booking-status";
import { getJobCoords, LOCATION_UNAVAILABLE_NOTE } from "@/lib/job-coords";
import type { StagePatch } from "@/lib/job-stage";
import { arrivalGateLines, failureSentence, locationRefusal, refusalCode, type LocationRefusal } from "@/lib/job-screen";
import { describeAcceptFailure } from "@/lib/offer";
import { describeConfirmationRefusal, professionalConfirmationFor } from "@/lib/professional-confirmation";
import { completedChecklistFor, describeChecklistRefusal } from "@/lib/quality-checklist";
import { partnerApi } from "@/services/partner-api";
import type { PartnerBookingsResponse } from "@/types/partner";

/** Every query the job screen and its panels keep for one booking: `["partner", <panel>, bookingId]`. */
export const JOB_PANEL_KEYS = ["job-evidence", "execution", "requirements", "safety", "quality", "completion", "cases", "job-earning", "job-contact"] as const;

export const jobDetailKey = (bookingId: string) => ["partner", "bookings", "by-id", bookingId] as const;
export const jobActionsKey = (bookingId: string) => ["partner", "job-actions", bookingId] as const;

/**
 * Ask the server again for everything a lifecycle change touches. The returned promise settles when
 * the DETAIL and the `/actions` answer have landed — a mutation that returns it from `onSettled`
 * stays pending until then, so the stage on screen goes straight from the old answer to the new one
 * and never flickers back. The lists and the panels refetch in the background.
 */
export function refreshJob(qc: QueryClient, bookingId: string): Promise<void> {
  const detailKey = jobDetailKey(bookingId);
  void qc.invalidateQueries({
    queryKey: ["partner", "bookings"],
    // The detail is refetched below, once; invalidating it here too would restart that fetch.
    predicate: (q) => !(q.queryKey[2] === "by-id" && q.queryKey[3] === bookingId),
  });
  for (const panel of JOB_PANEL_KEYS) void qc.invalidateQueries({ queryKey: ["partner", panel, bookingId] });
  return Promise.all([qc.invalidateQueries({ queryKey: detailKey }), qc.invalidateQueries({ queryKey: jobActionsKey(bookingId) })]).then(() => undefined);
}

export type LifecycleAction = "ACCEPT" | "DECLINE" | "START_NAVIGATION" | "MARK_ARRIVED" | "START_SERVICE" | "COMPLETE_SERVICE" | "CANCEL";

export type CompleteInput = {
  checklist: readonly string[];
  ticked: readonly string[];
  confirmationRequired: boolean;
  confirmed: boolean;
  /** Data URLs staged on the screen; sent ONCE, with the completion itself. */
  photos: readonly string[];
};

export type ArrivalNotice = { message: string | null; gateOk: boolean | null; gateLines: string[] };

/**
 * The job's lifecycle requests: accept, decline, on my way, arrived, start, complete, cancel.
 *
 * Server rules this implements:
 *  - arrive and start are ALWAYS sent; a phone with no fix sends `null` coordinates and the server
 *    decides (it lets a vouched partner through, and otherwise answers LOCATION_REQUIRED and friends
 *    in its own words — kept in `locationIssue` for a banner that stays on screen);
 *  - an arrival answer carries the ARRIVAL requirement gate (`arrival`);
 *  - the completion photo travels once, in `/complete`'s `photos` — there is no second upload;
 *  - nothing is shown as done until the server said so: `onServerPatch` receives the fields of the
 *    server's own answer, and every mutation stays pending until the detail has been read again.
 */
export function useJobLifecycle(
  bookingId: string,
  opts: {
    /** The stage fields the server just confirmed, to show while the detail is being read again. */
    onServerPatch: (patch: StagePatch) => void;
    onChecklistRefused: (stillNeeded: string[]) => void;
    onConfirmationRefused: () => void;
    /** The completion was accepted: staged photos have been stored by the server. */
    onCompleted: () => void;
  },
) {
  const qc = useQueryClient();
  const [locationIssue, setLocationIssue] = useState<LocationRefusal | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [arrival, setArrival] = useState<ArrivalNotice | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  const clear = useCallback(() => {
    setLocationIssue(null);
    setActionError(null);
    setNote(null);
    setResultMessage(null);
  }, []);

  const settle = useCallback(() => refreshJob(qc, bookingId), [qc, bookingId]);

  /** A refusal of arrive / start: the position sentences go to the banner, anything else to the error line. */
  const refuse = useCallback((error: unknown, sentWithoutFix: boolean) => {
    const position = locationRefusal(error, sentWithoutFix);
    if (position) setLocationIssue(position);
    else setActionError(failureSentence(error));
  }, []);

  const removeFromPending = useCallback(() => {
    qc.setQueriesData<PartnerBookingsResponse>({ queryKey: ["partner", "bookings"] }, (old) => {
      if (!old || !Array.isArray(old.bookings)) return old;
      const next = old.bookings.filter((b) => !(b.id === bookingId && isPendingStatus(b.status)));
      return next.length === old.bookings.length ? old : { ...old, bookings: next };
    });
  }, [qc, bookingId]);

  const accept = useMutation({
    // ETA: the booking's own server-computed value, or none. A client number would be an invented ETA.
    mutationFn: (eta: number | null) => partnerApi.acceptBooking(bookingId, typeof eta === "number" && eta >= 1 ? eta : undefined),
    onMutate: clear,
    onSuccess: (data) => {
      opts.onServerPatch({ status: data.booking.status });
      removeFromPending();
      void qc.invalidateQueries({ queryKey: ["partner", "operations"] });
      void qc.invalidateQueries({ queryKey: ["partner", "dashboard"] });
    },
    onError: (err) => {
      const failure = describeAcceptFailure(refusalCode(err), err instanceof Error ? err.message : null);
      setActionError(failure.message);
      if (failure.offerGone) removeFromPending();
      void qc.invalidateQueries({ queryKey: ["partner", "operations"] });
    },
    // Success or refusal, the server's answer is the truth about this offer.
    onSettled: settle,
  });

  const decline = useMutation({
    mutationFn: (reason: string) => partnerApi.rejectBooking(bookingId, reason),
    onMutate: clear,
    onSuccess: (data) => {
      removeFromPending();
      setResultMessage(data.message);
    },
    onError: (err) => setActionError(failureSentence(err)),
    onSettled: settle,
  });

  const enRoute = useMutation({
    mutationFn: async () => {
      const c = await getJobCoords("soft");
      const result = await partnerApi.markEnRoute(bookingId, c?.latitude ?? null, c?.longitude ?? null);
      return { result, sentWithoutFix: !c };
    },
    onMutate: clear,
    onSuccess: ({ result, sentWithoutFix }) => {
      setNote(sentWithoutFix ? LOCATION_UNAVAILABLE_NOTE : null);
      opts.onServerPatch({ status: result.booking.status, ...(result.booking.enRouteAt ? { enRouteAt: result.booking.enRouteAt } : {}) });
    },
    onError: (err) => setActionError(failureSentence(err)),
    onSettled: settle,
  });

  const arrived = useMutation({
    mutationFn: async () => {
      const c = await getJobCoords("strict");
      try {
        // Always sent. No fix → null coordinates, and the server decides (P0-6b).
        return await partnerApi.markArrived(bookingId, c?.latitude ?? null, c?.longitude ?? null, c?.mocked);
      } catch (error) {
        refuse(error, !c);
        throw error;
      }
    },
    onMutate: () => {
      clear();
      setArrival(null);
    },
    onSuccess: (result) => {
      setArrival({ message: result.message, gateOk: result.requirementGate ? result.requirementGate.ok : null, gateLines: arrivalGateLines(result.requirementGate) });
      if (result.booking.arrivedAt) opts.onServerPatch({ arrivedAt: result.booking.arrivedAt });
    },
    onSettled: settle,
  });

  const start = useMutation({
    mutationFn: async (otp: string | undefined) => {
      const c = await getJobCoords("strict");
      try {
        return await partnerApi.startBooking(bookingId, c?.latitude ?? null, c?.longitude ?? null, otp, c?.mocked);
      } catch (error) {
        // The PIN sheet shows the PIN refusals itself; a position refusal also stays on the screen.
        const position = locationRefusal(error, !c);
        if (position) setLocationIssue(position);
        throw error;
      }
    },
    onMutate: clear,
    onSuccess: (result) => {
      setArrival(null);
      opts.onServerPatch({ status: result.booking.status, ...(result.booking.startedAt ? { startedAt: result.booking.startedAt } : {}) });
    },
    onSettled: settle,
  });

  const complete = useMutation({
    mutationFn: async (input: CompleteInput) => {
      const c = await getJobCoords("soft");
      const result = await partnerApi.completeBooking(
        bookingId,
        c?.latitude ?? null,
        c?.longitude ?? null,
        undefined,
        input.photos.length ? [...input.photos] : undefined,
        // Only the items the partner ticked, as exact frozen strings; omitted when there is no checklist.
        completedChecklistFor(input.checklist, input.ticked),
        // `true` only when the row is required and the partner ticked it.
        professionalConfirmationFor(input.confirmationRequired, input.confirmed),
      );
      return { result, sentWithoutFix: !c };
    },
    onMutate: clear,
    onSuccess: ({ result, sentWithoutFix }) => {
      setNote(sentWithoutFix ? LOCATION_UNAVAILABLE_NOTE : null);
      opts.onCompleted();
      opts.onServerPatch({ status: result.booking.status, ...(result.booking.completedAt ? { completedAt: result.booking.completedAt } : {}) });
    },
    onError: async (err, input) => {
      const code = refusalCode(err);
      const message = failureSentence(err, "The job could not be completed. Please try again.");
      const confirmation = describeConfirmationRefusal(code, message);
      if (confirmation.confirmationRefused) {
        // Server truth wins: the row goes back to unticked and is flagged.
        setActionError(confirmation.message);
        opts.onConfirmationRefused();
        return;
      }
      if (code !== "QUALITY_CHECKLIST_REQUIRED") {
        // Evidence refusals (duplicate, too large, limit reached, …), safety holds, step gates: the server's sentence.
        setActionError(message);
        return;
      }
      // The refusal names what is missing in the quality history's last entry, not in the 409 body.
      let serverMissing: string[] | null = null;
      try {
        const quality = await partnerApi.getQuality(bookingId);
        const last = quality.history[quality.history.length - 1];
        serverMissing = last ? last.missingChecklistItems : null;
      } catch {
        /* every item is then treated as still needed */
      }
      const refusal = describeChecklistRefusal(code, message, input.checklist, serverMissing);
      setActionError(refusal.message);
      opts.onChecklistRefused(refusal.stillNeeded);
    },
    onSettled: settle,
  });

  const cancel = useMutation({
    mutationFn: (reason: string) => partnerApi.cancelBooking(bookingId, reason),
    onMutate: clear,
    onSuccess: (result) => {
      setArrival(null);
      // The server's sentence only. The refund fields of this answer describe the CUSTOMER's money
      // and are never shown to the partner.
      setResultMessage(result.message);
      opts.onServerPatch({ status: result.booking.status });
    },
    onSettled: settle,
  });

  const pendingAction: LifecycleAction | null = accept.isPending
    ? "ACCEPT"
    : decline.isPending
      ? "DECLINE"
      : enRoute.isPending
        ? "START_NAVIGATION"
        : arrived.isPending
          ? "MARK_ARRIVED"
          : start.isPending
            ? "START_SERVICE"
            : complete.isPending
              ? "COMPLETE_SERVICE"
              : cancel.isPending
                ? "CANCEL"
                : null;

  return {
    accept,
    decline,
    enRoute,
    arrived,
    start,
    complete,
    cancel,
    pendingAction,
    busy: pendingAction !== null,
    locationIssue,
    actionError,
    note,
    arrival,
    resultMessage,
    dismissLocationIssue: () => setLocationIssue(null),
  };
}

export type JobLifecycle = ReturnType<typeof useJobLifecycle>;
