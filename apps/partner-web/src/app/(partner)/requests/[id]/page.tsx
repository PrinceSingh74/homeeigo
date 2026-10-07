"use client";

import { JobBrief } from "@/components/requests/JobBrief";
import { hasPreparationPart, JobPreparation } from "@/components/requests/JobPreparation";
import { RequirementChecklist } from "@/components/requests/RequirementChecklist";
import { ExecutionSteps, useJobExecution } from "@/components/requests/ExecutionSteps";
import { SafetyPanel, useJobSafety } from "@/components/requests/SafetyPanel";
import { QualityPanel } from "@/components/requests/QualityPanel";
import { CompletionChecklist } from "@/components/requests/CompletionChecklist";
import { BriefEmpty, BriefSection, BriefSectionNav, type BriefSectionDef } from "@/components/requests/ExecutionBriefLayout";
import { ChecklistPreview, CompletionCriteria, ProfessionalConfirmation, ProofRequirements } from "@/components/requests/QualityBrief";
import { EscalationGuide } from "@/components/requests/EscalationGuide";
import { followUpLine } from "@/lib/follow-up";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  Camera,
  CheckCircle2,
  ClipboardList,
  Clock,
  ExternalLink,
  LifeBuoy,
  ListChecks,
  MapPin,
  MapPinCheck,
  MessageSquare,
  Navigation,
  Package,
  PlayCircle,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { BookingRequestCard } from "@/components/requests/BookingRequestCard";
import { CallCustomerButton } from "@/components/requests/CallCustomerButton";
import { JobChatPanel } from "@/components/requests/JobChatPanel";
import { JobEvidencePanel } from "@/components/requests/JobEvidencePanel";
import { NoShowSection } from "@/components/requests/NoShowSection";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { useBookingRequirementsQuery } from "@/hooks/use-partner-data";
import { bookingDetailKey } from "@/lib/booking-cache";
import { jobAccessDetails } from "@/lib/job-access";
import { getAvailableJobActions, primaryActionToLocalCta } from "@/lib/job-action-policy";
import { googleDirectionsUrl, jobDestination, navigationHref } from "@/lib/job-navigation";
import { isActiveJobStatus, isOfferStatus, jobSubResourcesEnabled } from "@/lib/job-stage";
import { partnerLayout } from "@/lib/partner-layout";
import { formatDate, formatTime } from "@/lib/format";
import { partnerApi } from "@/services/partner-api";

/**
 * The execution brief, in the order a professional reads a job: what it is, what must be in place,
 * what to bring, how to stay safe, what to do, what "done" means, what to prove, and who to call on.
 * The ids are the in-page anchors of the section nav.
 */
const BRIEF = {
  summary: { id: "brief-summary", title: "Job summary", icon: ClipboardList },
  requirements: { id: "brief-requirements", title: "Requirements", icon: ShieldCheck },
  materials: { id: "brief-materials", title: "Materials", icon: Package },
  equipment: { id: "brief-equipment", title: "Equipment", icon: Wrench },
  safety: { id: "brief-safety", title: "Safety", icon: ShieldAlert },
  steps: { id: "brief-steps", title: "Service steps", icon: ListChecks },
  quality: { id: "brief-quality", title: "Quality checklist", icon: BadgeCheck },
  proof: { id: "brief-proof", title: "Proof", icon: Camera },
  escalation: { id: "brief-escalation", title: "Escalation", icon: LifeBuoy },
} as const satisfies Record<string, BriefSectionDef>;
const BRIEF_ORDER: readonly BriefSectionDef[] = Object.values(BRIEF);

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useQuery({
    queryKey: bookingDetailKey(id),
    queryFn: () => partnerApi.getBooking(id),
    enabled: !!id,
  });
  const booking = detail.data ?? null;

  /**
   * An OFFER (status pending) is not this partner's job yet: the server answers its sub-resources
   * (`/actions`, `/requirements`, `/execution`, `/safety`, `/quality`, `/completion`, `/evidence`) with
   * 404 or an empty list by design. None of those reads fire for an offer — the brief below is drawn
   * from the booking payload, and the sections that need the job to be held say when they open.
   */
  const isOffer = isOfferStatus(booking?.status);
  const reads = jobSubResourcesEnabled(booking?.status);

  const actionsQuery = useQuery({
    queryKey: ["partner", "job-actions", id],
    queryFn: () => partnerApi.getJobActions(id),
    enabled: !!id && reads.actions,
    staleTime: 15_000,
  });

  const refetchActions = actionsQuery.refetch;
  const refreshActions = useCallback(() => void refetchActions(), [refetchActions]);

  const localActions = booking ? getAvailableJobActions(booking) : null;
  const actions = actionsQuery.data ?? localActions;
  const nextCta = primaryActionToLocalCta(actions?.primaryAction ?? null);

  const customerName = booking
    ? `${booking.customer.firstName ?? ""} ${booking.customer.lastName ?? ""}`.trim() ||
      "Customer"
    : "";

  const isActive = isActiveJobStatus(booking?.status);
  // Only what the payload carries: the note and access fields arrive non-null while the job is held.
  const accessDetails = booking ? jobAccessDetails(booking) : [];
  // Navigation is offered only when the booking itself carries coordinates — and always to THIS job.
  const destination = jobDestination(booking);

  const timeline = booking
    ? [
        { key: "enRouteAt", label: "On the way", at: booking.enRouteAt, Icon: Navigation },
        { key: "arrivedAt", label: "Arrived", at: booking.arrivedAt, Icon: MapPinCheck },
        { key: "startedAt", label: "Started", at: booking.startedAt, Icon: PlayCircle },
        { key: "completedAt", label: "Completed", at: booking.completedAt, Icon: CheckCircle2 },
      ]
    : [];

  const [showChat, setShowChat] = useState(true);

  const isInProgress = booking?.status === "in_progress";

  /**
   * The booking's FROZEN quality checklist (`GET /api/bookings/:id` → execution.quality). Fetched
   * only while the job is in progress — that is the only time the partner can tick it. The ticks are
   * page state so "Mark complete" (in the card below) sends exactly what was ticked here.
   */
  const executionQuery = useQuery({
    queryKey: ["partner", "execution-brief", id],
    queryFn: () => partnerApi.getBookingExecutionBrief(id),
    // X-30: the frozen materials / equipment copy is needed before arrival too, not only in progress.
    enabled: !!id,
    staleTime: 60_000,
  });
  const quality = executionQuery.data?.quality ?? null;
  const checklist = quality?.checklist ?? [];
  const policyCopy = executionQuery.data?.policy ?? null;
  /**
   * The partner's own attestation that the completion criteria were met — asked for only when the
   * frozen policy sets `professionalConfirmation`. Page state for the same reason as the ticks: the
   * Complete action reads it, and sends `true` only when this box is ticked.
   */
  const confirmationRequired = quality?.professionalConfirmation === true;
  const [criteriaConfirmed, setCriteriaConfirmed] = useState(false);

  // Same keys as the panels below, so these are the panels' own fetches, not extra requests.
  // Enabled only once the booking is known to be this partner's — as when the panels fetched alone.
  const safetyQuery = useJobSafety(id, reads.safety);
  const stepsQuery = useJobExecution(id, reads.execution);
  const requirementsQuery = useBookingRequirementsQuery(id, reads.requirements);
  const hasSteps = stepsQuery.data?.enforced === true && stepsQuery.data.steps.length > 0;
  const hasRequirementItems = requirementsQuery.data?.enforced === true && requirementsQuery.data.items.length > 0;
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  const toggleItem = useCallback((item: string, checked: boolean) => {
    setTicked((prev) => {
      if (prev.has(item) === checked) return prev;
      const next = new Set(prev);
      if (checked) next.add(item);
      else next.delete(item);
      return next;
    });
  }, []);

  if (detail.isLoading) {
    return (
      <div className={partnerLayout.pageStack}>
        <p className="text-sm text-partner-muted">Loading job…</p>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className={partnerLayout.pageStack}>
        <Link
          href="/requests"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-partner-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to bookings
        </Link>
        <PartnerCard hover={false}>
          <p className="text-sm text-partner-muted">Job not found in your bookings.</p>
        </PartnerCard>
      </div>
    );
  }

  return (
    <div className={partnerLayout.pageStack} data-testid="job-detail-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/requests"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-partner-muted hover:text-partner-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Bookings
          </Link>
          <h1 className="font-display text-2xl font-bold tracking-tight text-partner-text">
            {customerName}
          </h1>
          <p className="text-sm text-partner-text-secondary">
            {booking.service.name} · {booking.bookingNumber}
            {booking.customer.phoneMasked ? ` · ${booking.customer.phoneMasked}` : ""}
          </p>
          {followUpLine(booking.followUp) ? (
            <p data-testid="job-follow-up" className="text-sm font-semibold text-partner-text">
              {followUpLine(booking.followUp)}. The customer reported an issue with the earlier visit; this visit follows up on it.
            </p>
          ) : null}
        </div>
        <span className="rounded-full bg-partner-primary/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-partner-text">
          {booking.status.replace(/_/g, " ")}
        </span>
      </div>

      <BriefSectionNav sections={BRIEF_ORDER} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <PartnerCard hover={false} className="divide-y divide-partner-line" data-testid="execution-brief">
          <BriefSection def={BRIEF.summary} number={1}>
            <p className="flex items-start gap-2 text-sm text-partner-text-secondary">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-partner-primary" aria-hidden="true" />
              {booking.address?.fullAddress ?? "Address pending"}
            </p>
            {accessDetails.length > 0 ? (
              <dl className="space-y-2 rounded-xl bg-partner-bg/60 px-3 py-3" data-testid="job-access-details">
                {accessDetails.map((row) => (
                  <div key={row.key} data-testid={`job-access-${row.key}`}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-partner-muted">{row.label}</dt>
                    <dd className="whitespace-pre-line break-words text-sm text-partner-text">{row.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {destination ? (
              <div className="flex flex-wrap gap-2">
                <Link
                  href={navigationHref(booking.id)}
                  data-testid="job-navigate"
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-partner-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-partner-primary focus-visible:ring-offset-2"
                >
                  <Navigation className="h-4 w-4" aria-hidden="true" />
                  Navigate
                </Link>
                {/* Works without the in-app map (no Maps key, slow network): the phone's own maps app. */}
                <a
                  href={googleDirectionsUrl(destination)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="job-navigate-external"
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-partner-line px-4 py-2.5 text-sm font-semibold text-partner-text transition hover:border-partner-primary/50"
                >
                  <ExternalLink className="h-4 w-4 text-partner-primary" aria-hidden="true" />
                  Open in Google Maps
                </a>
              </div>
            ) : null}
            <p className="flex items-center gap-2 text-xs text-partner-muted">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Scheduled {formatDate(booking.scheduledDate)} · {formatTime(booking.scheduledDate)}
            </p>
            <JobBrief job={booking.job} />
            {isOffer ? (
              <p role="status" data-testid="job-offer-notice" className="rounded-xl border border-partner-warning/40 bg-partner-warning/10 px-3 py-2.5 text-sm text-partner-text">
                This job is offered to you and is not accepted yet. Arrival, service steps, the checklist and proof open once the job is accepted.
              </p>
            ) : null}
            {nextCta ? (
              <p className="text-xs font-semibold text-partner-text-secondary">
                Next:{" "}
                {nextCta === "en_route"
                  ? "On my way"
                  : nextCta === "arrived"
                    ? "I've arrived"
                    : nextCta === "start"
                      ? "Start job"
                      : nextCta === "complete"
                        ? "Mark complete"
                        : "Accept"}
              </p>
            ) : null}
            {isActive ? (
              <div className="flex flex-wrap gap-2 pt-1">
                <CallCustomerButton
                  bookingId={booking.id}
                  phoneMasked={booking.customer.phoneMasked}
                  className="min-w-[10rem] flex-1"
                />
                <button
                  type="button"
                  onClick={() => setShowChat((v) => !v)}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-partner-line px-4 py-2.5 text-sm font-semibold text-partner-text transition hover:border-partner-primary/50"
                >
                  <MessageSquare className="h-4 w-4 text-partner-primary" />
                  {showChat ? "Hide chat" : "Open chat"}
                </button>
              </div>
            ) : null}
          </BriefSection>

          <BriefSection def={BRIEF.requirements} number={2}>
            {/* The live requirement state belongs to the partner who holds the job; an offer shows the snapshot only. */}
            {isOffer ? null : (
              <RequirementChecklist bookingId={booking.id} active={isActive} gate={actionsQuery.data?.requirementGate ?? null} heading={false} />
            )}
            <JobPreparation requirements={booking.requirements} only="customer" />
            {!hasRequirementItems && !requirementsQuery.isLoading && !hasPreparationPart(booking.requirements, "customer") ? (
              <BriefEmpty>
                {isOffer
                  ? "This offer records nothing the customer must provide or prepare. The on-site requirement checks open once the job is accepted."
                  : "No requirements are recorded for this job."}
              </BriefEmpty>
            ) : null}
          </BriefSection>

          <BriefSection def={BRIEF.materials} number={3}>
            <JobPreparation requirements={booking.requirements} only="materials" />
            {policyCopy?.materials ? (
              <p className="text-sm text-partner-text-secondary" data-testid="job-policy-materials">{policyCopy.materials}</p>
            ) : null}
            {!hasPreparationPart(booking.requirements, "materials") && !policyCopy?.materials ? (
              <BriefEmpty>
                {executionQuery.isLoading
                  ? "Loading materials…"
                  : hasSteps
                    ? "No materials are listed for the job as a whole. Each service step shows the materials it needs."
                    : "No materials are listed for this job."}
              </BriefEmpty>
            ) : null}
          </BriefSection>

          <BriefSection def={BRIEF.equipment} number={4}>
            <JobPreparation requirements={booking.requirements} only="equipment" />
            {policyCopy?.equipment ? (
              <p className="text-sm text-partner-text-secondary" data-testid="job-policy-equipment">{policyCopy.equipment}</p>
            ) : null}
            {!hasPreparationPart(booking.requirements, "equipment") && !policyCopy?.equipment ? (
              <BriefEmpty>
                {executionQuery.isLoading
                  ? "Loading equipment…"
                  : hasSteps
                    ? "No equipment is listed for the job as a whole. Each service step shows the equipment it needs."
                    : "No equipment is listed for this job."}
              </BriefEmpty>
            ) : null}
          </BriefSection>

          {/* §9 precedence: a safety hold outranks every later section. */}
          <BriefSection def={BRIEF.safety} number={5}>
            {isOffer ? (
              <BriefEmpty>Safety rules and the report form open once the job is accepted.</BriefEmpty>
            ) : (
              <SafetyPanel bookingId={booking.id} heading={false} emptyText="No safety rules are recorded for this job." />
            )}
          </BriefSection>

          <BriefSection def={BRIEF.steps} number={6}>
            {isOffer ? (
              <BriefEmpty>The step-by-step plan opens once the job is accepted.</BriefEmpty>
            ) : (
              <ExecutionSteps bookingId={booking.id} heading={false} emptyText="This service has no step-by-step plan. Follow the job summary and the quality checklist." />
            )}
          </BriefSection>

          <BriefSection def={BRIEF.quality} number={7}>
            {executionQuery.isLoading ? (
              <BriefEmpty>Loading the quality policy…</BriefEmpty>
            ) : executionQuery.isError ? (
              <BriefEmpty>The quality policy could not be loaded — refresh the page to try again.</BriefEmpty>
            ) : (
              <>
                <CompletionCriteria criteria={quality?.completionCriteria ?? []} />
                {/* The service quality checklist "Mark complete" submits — server-matched item by item. */}
                {isInProgress ? (
                  <CompletionChecklist
                    bookingId={booking.id}
                    checklist={checklist}
                    ticked={ticked}
                    onToggle={toggleItem}
                    confirmationPending={confirmationRequired && !criteriaConfirmed}
                  />
                ) : (
                  <ChecklistPreview checklist={checklist} />
                )}
                {confirmationRequired ? (
                  isInProgress ? (
                    <ProfessionalConfirmation bookingId={booking.id} confirmed={criteriaConfirmed} onChange={setCriteriaConfirmed} />
                  ) : (
                    <p className="text-xs text-partner-muted" data-testid="professional-confirmation-notice">
                      Before you mark this job complete you will be asked to confirm the completion criteria were met.
                    </p>
                  )
                ) : null}
                {!quality?.completionCriteria.length && checklist.length === 0 && !confirmationRequired ? (
                  <BriefEmpty>This service has no quality checklist.</BriefEmpty>
                ) : null}
              </>
            )}
            {/* §10: the recorded quality verdict (and why a complete was refused); §11: reported issues. */}
            {isOffer ? null : <QualityPanel bookingId={booking.id} heading={false} />}
          </BriefSection>

          <BriefSection def={BRIEF.proof} number={8}>
            {quality ? <ProofRequirements proofRequired={quality.proofRequired} beforeAfterPhotos={quality.beforeAfterPhotos} /> : null}
            {isOffer ? (
              <BriefEmpty>Proof upload opens once the job is accepted.</BriefEmpty>
            ) : (
              <JobEvidencePanel bookingId={booking.id} embedded />
            )}
          </BriefSection>

          <BriefSection def={BRIEF.escalation} number={9}>
            <EscalationGuide
              incidentProtocol={safetyQuery.data?.safety?.incidentProtocol ?? null}
              emergencyProtocol={safetyQuery.data?.safety?.emergencyProtocol ?? null}
              canReportCondition={(safetyQuery.data?.canReport.length ?? 0) > 0}
              hasSteps={hasSteps}
              safetySectionId={BRIEF.safety.id}
              stepsSectionId={BRIEF.steps.id}
            />
          </BriefSection>
        </PartnerCard>

        <div className="space-y-6">
          <BookingRequestCard
            serverActions={actionsQuery.data ?? null}
            request={booking}
            completion={
              isInProgress
                ? {
                    checklist,
                    ticked,
                    loading: executionQuery.isLoading,
                    unavailable: executionQuery.isError,
                    confirmation: { required: confirmationRequired, confirmed: criteriaConfirmed },
                  }
                : undefined
            }
          />

          {/* §52: secondary to Start, collapsed by default; drawn only from the server's `noShow` answer. */}
          {isOffer ? null : (
            <NoShowSection
              bookingId={booking.id}
              preview={actionsQuery.data?.noShow ?? null}
              fetchedAt={actionsQuery.dataUpdatedAt}
              refreshing={actionsQuery.isFetching}
              onRefresh={refreshActions}
            />
          )}

          <PartnerCard hover={false}>
            <p className="mb-3 text-sm font-semibold text-partner-text">Lifecycle</p>
            <ol className="space-y-3">
              {timeline.map(({ key, label, at, Icon }) => (
                <li key={key} className="flex items-center gap-3 text-sm">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      at ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100" : "bg-partner-bg text-partner-muted"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="font-medium text-partner-text">{label}</p>
                    <p className="text-[11px] text-partner-muted">
                      {at ? `${formatDate(at)} · ${formatTime(at)}` : "Pending"}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </PartnerCard>

          {showChat ? (
            <JobChatPanel
              bookingId={booking.id}
              status={booking.status}
              customerName={customerName}
              bookingNumber={booking.bookingNumber}
              phoneMasked={booking.customer.phoneMasked}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
