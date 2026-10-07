"use client";

import { useState } from "react";
import { useConfirmArrivalMutation } from "@/hooks/use-core-data";
import { canOfferArrivalConfirmation, confirmationStillStands, type RememberedConfirmation } from "@/lib/arrival-confirmation";

/**
 * Confirmations the server accepted in this session, by booking: who they vouched for and until
 * when. While one stands the control is not offered again, even after the modal is reopened; once
 * the job passes to another professional or the time runs out, it is.
 */
const confirmedThisSession = new Map<string, RememberedConfirmation>();

/**
 * The customer's side of the arrival exception: a small, explained, secondary control.
 *
 * Arrival is normally established by the professional's device, so this is a quiet link, not a step
 * in the booking — most customers never need it. It asks before acting and says exactly what
 * confirming does. What the server answers (the thanks, or why it refused) is shown as the server
 * wrote it.
 */
export function ArrivalConfirmation({
  bookingId,
  backendStatus,
  hasProfessional,
  professionalId = null,
  arrivedAt,
}: {
  bookingId: string;
  backendStatus: string | null | undefined;
  hasProfessional: boolean;
  /** The professional on the booking now: a confirmation vouches for that person only. */
  professionalId?: string | null;
  arrivedAt: string | null | undefined;
}) {
  const confirm = useConfirmArrivalMutation();
  const [asking, setAsking] = useState(false);
  /** The server's sentence after an attempt for THIS booking. */
  const [result, setResult] = useState<{ bookingId: string; message: string; ok: boolean } | null>(null);
  const stands = confirmationStillStands(confirmedThisSession.get(bookingId), { professionalId, now: Date.now() });
  // An acknowledgement is shown only while the confirmation behind it stands; a refusal is always shown.
  const shown = result?.bookingId === bookingId && (!result.ok || stands) ? result : null;

  const offer = canOfferArrivalConfirmation({
    backendStatus,
    hasProfessional,
    arrivedAt,
    confirmedThisSession: stands,
  });

  // Once confirmed, only the server's acknowledgement remains — and only until the job starts.
  if (shown?.ok) {
    const started = !["accepted", "assigned", "en_route"].includes((backendStatus ?? "").toLowerCase());
    if (started) return null;
    return (
      <p role="status" data-testid="arrival-confirmed" className="text-xs text-muted">
        {shown.message}
      </p>
    );
  }
  if (!offer) return null;

  const submit = () =>
    confirm.mutate(bookingId, {
      onSuccess: (r) => {
        confirmedThisSession.set(bookingId, { professionalId, validUntil: r.validUntil });
        setAsking(false);
        // The server's own sentence; if it sent none, a plain statement of what was recorded.
        setResult({ bookingId, message: r.message ?? "Your confirmation was recorded.", ok: true });
      },
      onError: (e) => {
        setAsking(false);
        // A refusal carries the server's sentence (e.g. 409 INVALID_STATUS). A request that never
        // reached the server has no such sentence — only say that it did not go through.
        const answered = ((e as { status?: number } | null)?.status ?? 0) >= 400;
        setResult({
          bookingId,
          message: answered && e instanceof Error && e.message ? e.message : "This could not be confirmed right now. Please try again.",
          ok: false,
        });
      },
    });

  return (
    <div data-testid="arrival-confirmation" className="text-xs text-muted">
      {!asking ? (
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setAsking(true);
          }}
          className="inline-flex min-h-11 items-center rounded-lg text-left text-xs font-medium text-muted underline underline-offset-4 outline-none transition hover:text-content focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          Is your professional at the door but can&apos;t check in?
        </button>
      ) : (
        <div
          id={`arrival-confirm-${bookingId}`}
          role="group"
          aria-label="Confirm your professional is at the door"
          className="rounded-2xl border border-line bg-surface/60 p-4"
        >
          <p className="text-sm text-content">
            Confirm only if the professional is physically at your address. This lets them check in when their phone cannot get a location.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={confirm.isPending}
              aria-label="Confirm the professional is at my address"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line px-4 text-sm font-semibold text-content outline-none transition hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-60"
            >
              {confirm.isPending ? "Confirming…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              disabled={confirm.isPending}
              aria-label="Cancel — do not confirm arrival"
              className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-muted outline-none transition hover:text-content focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {/* A refusal: the server's sentence (e.g. no professional is on the way to this booking). */}
      {shown && !shown.ok ? (
        <p role="alert" data-testid="arrival-refused" className="mt-2 text-xs text-warning">
          {shown.message}
        </p>
      ) : null}
    </div>
  );
}
