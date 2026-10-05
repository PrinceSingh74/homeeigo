import Link from "next/link";
import { ArrowUpRight, HeartPulse, HelpCircle, OctagonAlert, ShieldAlert, Siren, TriangleAlert } from "lucide-react";

/**
 * How to escalate on THIS job — one place, built only from what exists: the booking's frozen
 * incident / emergency protocol text, the two in-app escalation actions (report a prohibited
 * condition, escalate a step) and the app's own SOS and support pages. No phone numbers or
 * contacts are written here; the SOS page owns those.
 */
export function EscalationGuide({
  incidentProtocol,
  emergencyProtocol,
  canReportCondition,
  hasSteps,
  safetySectionId,
  stepsSectionId,
}: {
  incidentProtocol: string | null;
  emergencyProtocol: string | null;
  /** The server currently offers "Report a prohibited condition" on this job. */
  canReportCondition: boolean;
  /** The booking has a step plan (each step can carry an Escalate action). */
  hasSteps: boolean;
  safetySectionId: string;
  stepsSectionId: string;
}) {
  const linkClass =
    "inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-partner-line px-3 text-sm font-semibold text-partner-text transition hover:border-partner-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-primary";
  return (
    <div className="space-y-4" data-testid="escalation-guide">
      {emergencyProtocol ? (
        <div className="flex items-start gap-2 text-sm text-partner-text-secondary" data-testid="escalation-emergency-protocol">
          <Siren className="mt-0.5 h-4 w-4 shrink-0 text-partner-primary" aria-hidden="true" />
          <p><span className="font-semibold text-partner-text">In an emergency: </span>{emergencyProtocol}</p>
        </div>
      ) : null}
      {incidentProtocol ? (
        <div className="flex items-start gap-2 text-sm text-partner-text-secondary" data-testid="escalation-incident-protocol">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-partner-primary" aria-hidden="true" />
          <p><span className="font-semibold text-partner-text">If an incident happens: </span>{incidentProtocol}</p>
        </div>
      ) : null}
      {!emergencyProtocol && !incidentProtocol ? (
        <p className="text-sm text-partner-muted" data-testid="escalation-neutral">
          This service has no job-specific escalation instructions. There are two ways to escalate from this page: report a
          prohibited condition, which stops the job and alerts the safety team, or escalate a single service step, which sends
          that step to the support team for review.
        </p>
      ) : null}

      <ul className="space-y-3">
        <li className="flex items-start gap-2">
          <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0 text-partner-primary" aria-hidden="true" />
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-semibold text-partner-text">Report a prohibited condition</p>
            <p className="text-xs text-partner-text-secondary">
              Found something work must not continue with? Reporting it stops the job and alerts the safety team. Only they can
              clear the hold.
            </p>
            {canReportCondition ? (
              <a href={`#${safetySectionId}`} className={linkClass}>Go to Safety</a>
            ) : (
              <p className="text-xs text-partner-muted">Not available on this job right now — it appears under Safety when the job has conditions you can report.</p>
            )}
          </div>
        </li>
        <li className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-partner-primary" aria-hidden="true" />
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-semibold text-partner-text">Escalate a service step</p>
            <p className="text-xs text-partner-text-secondary">
              When a step cannot be done safely or correctly, use Escalate on that step and give a reason. The step goes to the
              support team and the job cannot be completed until it is reviewed.
            </p>
            {hasSteps ? (
              <a href={`#${stepsSectionId}`} className={linkClass}>Go to Service steps</a>
            ) : (
              <p className="text-xs text-partner-muted">This job has no step plan, so there is no step to escalate.</p>
            )}
          </div>
        </li>
      </ul>

      <div className="flex flex-wrap gap-2 border-t border-partner-line pt-3">
        <Link href="/wellbeing/sos" className={linkClass} data-testid="escalation-sos-link">
          <HeartPulse className="h-4 w-4 text-partner-primary" aria-hidden="true" />
          SOS — your own safety
          <ArrowUpRight className="h-3.5 w-3.5 text-partner-muted" aria-hidden="true" />
        </Link>
        <Link href="/support" className={linkClass} data-testid="escalation-support-link">
          <HelpCircle className="h-4 w-4 text-partner-primary" aria-hidden="true" />
          Help &amp; Support
          <ArrowUpRight className="h-3.5 w-3.5 text-partner-muted" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
