import { Camera, ClipboardCheck, Images, Target } from "lucide-react";
import { PROFESSIONAL_CONFIRMATION_LABEL } from "@/lib/completion-checklist";

/**
 * The read-only and attestation parts of the booking's FROZEN quality policy
 * (`GET /api/bookings/:id` → `booking.execution.quality`): what done means, the checklist before it
 * can be ticked, the proof the server will ask for, and the partner's own confirmation. Everything
 * is the server's wording; nothing is shown that the policy does not carry.
 */

/** "What done means" — the completion criteria, above the checklist. */
export function CompletionCriteria({ criteria }: { criteria: readonly string[] }) {
  if (criteria.length === 0) return null;
  return (
    <div className="space-y-1.5" data-testid="completion-criteria">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-partner-text">
        <Target className="h-4 w-4 text-partner-primary" aria-hidden="true" />
        What done means
      </p>
      <ul className="list-disc space-y-1 pl-6 text-sm text-partner-text-secondary">
        {criteria.map((c, i) => <li key={`${i}:${c}`}>{c}</li>)}
      </ul>
    </div>
  );
}

/** The checklist as a preview: it can only be ticked while the job is in progress. */
export function ChecklistPreview({ checklist }: { checklist: readonly string[] }) {
  if (checklist.length === 0) return null;
  return (
    <div className="space-y-1.5" data-testid="completion-checklist-preview">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-partner-text">
        <ClipboardCheck className="h-4 w-4 text-partner-primary" aria-hidden="true" />
        Service checklist <span className="font-normal text-partner-muted">· {checklist.length} item{checklist.length === 1 ? "" : "s"}</span>
      </p>
      <p className="text-xs text-partner-muted">You tick these off here while the job is in progress.</p>
      <ul className="list-disc space-y-1 pl-6 text-sm text-partner-text-secondary">
        {checklist.map((c, i) => <li key={`${i}:${c}`}>{c}</li>)}
      </ul>
    </div>
  );
}

/**
 * The required attestation. A real checkbox with its label; "Required" is a word, not a colour.
 * Ticking it is the only thing that puts `professionalConfirmation: true` on the complete request.
 */
export function ProfessionalConfirmation({
  bookingId,
  confirmed,
  onChange,
}: {
  bookingId: string;
  confirmed: boolean;
  onChange: (confirmed: boolean) => void;
}) {
  const id = `professional-confirmation-${bookingId}`;
  return (
    <div className="rounded-xl border border-partner-line p-3" data-testid="professional-confirmation" data-confirmed={confirmed}>
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3">
        <input
          id={id}
          type="checkbox"
          checked={confirmed}
          required
          aria-describedby={`${id}-hint`}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 cursor-pointer rounded border-partner-line accent-partner-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-primary focus-visible:ring-offset-2"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-partner-text">
            {PROFESSIONAL_CONFIRMATION_LABEL} <span className="font-normal text-partner-muted">(required)</span>
          </span>
          <span id={`${id}-hint`} className="block text-xs text-partner-muted">
            {confirmed
              ? "Confirmed — this is recorded with the job when you mark it complete."
              : "This service needs your confirmation. The job cannot be marked complete until you tick this."}
          </span>
        </span>
      </label>
    </div>
  );
}

/** What proof the quality policy demands at completion, said outright. */
export function ProofRequirements({ proofRequired, beforeAfterPhotos }: { proofRequired: boolean; beforeAfterPhotos: boolean }) {
  if (!proofRequired && !beforeAfterPhotos) {
    return (
      <p className="text-sm text-partner-muted" data-testid="proof-requirements" data-required="false">
        This service&apos;s quality policy does not require proof photos. A service step can still ask for one.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5" data-testid="proof-requirements" data-required="true">
      {proofRequired ? (
        <li className="flex items-start gap-2 text-sm font-medium text-partner-text">
          <Camera className="mt-0.5 h-4 w-4 shrink-0 text-partner-primary" aria-hidden="true" />
          Photo proof required at completion
        </li>
      ) : null}
      {beforeAfterPhotos ? (
        <li className="flex items-start gap-2 text-sm font-medium text-partner-text">
          <Images className="mt-0.5 h-4 w-4 shrink-0 text-partner-primary" aria-hidden="true" />
          Before and after photos required
        </li>
      ) : null}
    </ul>
  );
}
