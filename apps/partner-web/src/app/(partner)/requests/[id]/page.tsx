"use client";

import { JobBrief } from "@/components/requests/JobBrief";
import { JobPreparation } from "@/components/requests/JobPreparation";
import { RequirementChecklist } from "@/components/requests/RequirementChecklist";
import { ExecutionSteps } from "@/components/requests/ExecutionSteps";
import { SafetyPanel } from "@/components/requests/SafetyPanel";
import { QualityPanel } from "@/components/requests/QualityPanel";
import { CompletionChecklist } from "@/components/requests/CompletionChecklist";
import { followUpLine } from "@/lib/follow-up";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  MapPin,
  MapPinCheck,
  MessageSquare,
  Navigation,
  PlayCircle,
} from "lucide-react";
import { BookingRequestCard } from "@/components/requests/BookingRequestCard";
import { CallCustomerButton } from "@/components/requests/CallCustomerButton";
import { JobChatPanel } from "@/components/requests/JobChatPanel";
import { JobEvidencePanel } from "@/components/requests/JobEvidencePanel";
import { PartnerCard } from "@/components/ui/PartnerCard";
import {
  ACTIVE_BOOKINGS_PARAMS,
  partnerKeys,
  usePartnerBookingsQuery,
} from "@/hooks/use-partner-data";
import { getAvailableJobActions, primaryActionToLocalCta } from "@/lib/job-action-policy";
import { partnerLayout } from "@/lib/partner-layout";
import { formatDate, formatTime } from "@/lib/format";
import { partnerApi } from "@/services/partner-api";
import type { PartnerBooking } from "@/types/partner";

function findInCaches(
  caches: Array<{ bookings?: PartnerBooking[] } | undefined>,
  id: string,
): PartnerBooking | undefined {
  for (const cache of caches) {
    const hit = cache?.bookings?.find((b) => b.id === id);
    if (hit) return hit;
  }
  return undefined;
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const pending = usePartnerBookingsQuery({ status: "pending", limit: 20, sortBy: "recent" });
  const active = usePartnerBookingsQuery(ACTIVE_BOOKINGS_PARAMS);
  const completed = usePartnerBookingsQuery({
    status: "completed",
    limit: 20,
    sortBy: "recent",
  });

  const bookingFromList = useMemo(
    () => findInCaches([pending.data, active.data, completed.data], id),
    [pending.data, active.data, completed.data, id],
  );

  const refetchList = useQuery({
    queryKey: [...partnerKeys.bookingsAll, "detail-lookup", id],
    queryFn: () => partnerApi.listBookings({ limit: 50, sortBy: "recent" }),
    enabled: !bookingFromList && !!id,
  });

  const booking =
    bookingFromList ?? refetchList.data?.bookings?.find((b) => b.id === id) ?? null;

  const actionsQuery = useQuery({
    queryKey: ["partner", "job-actions", id],
    queryFn: () => partnerApi.getJobActions(id),
    enabled: !!id && !!booking,
    staleTime: 15_000,
  });

  const localActions = booking ? getAvailableJobActions(booking) : null;
  const actions = actionsQuery.data ?? localActions;
  const nextCta = primaryActionToLocalCta(actions?.primaryAction ?? null);

  const customerName = booking
    ? `${booking.customer.firstName ?? ""} ${booking.customer.lastName ?? ""}`.trim() ||
      "Customer"
    : "";

  const isActive =
    booking != null &&
    ["accepted", "assigned", "en_route", "in_progress"].includes(booking.status);

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
  const checklist = executionQuery.data?.quality.checklist ?? [];
  const policyCopy = executionQuery.data?.policy ?? null;
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

  if (pending.isLoading || active.isLoading || (refetchList.isFetching && !booking)) {
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <PartnerCard hover={false} className="space-y-3">
            <p className="flex items-start gap-2 text-sm text-partner-text-secondary">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-partner-primary" />
              {booking.address?.fullAddress ?? "Address pending"}
            </p>
            <p className="flex items-center gap-2 text-xs text-partner-muted">
              <Clock className="h-3.5 w-3.5" />
              Scheduled {formatDate(booking.scheduledDate)} · {formatTime(booking.scheduledDate)}
            </p>
            <JobBrief job={booking.job} />
            <JobPreparation requirements={booking.requirements} />
            {policyCopy && (policyCopy.materials || policyCopy.equipment) ? (
              <div className="space-y-1" data-testid="job-policy-copy">
                <p className="text-xs font-semibold uppercase tracking-wide text-partner-muted">Materials &amp; equipment</p>
                {policyCopy.materials ? <p className="text-sm text-partner-text-secondary">{policyCopy.materials}</p> : null}
                {policyCopy.equipment ? <p className="text-sm text-partner-text-secondary">{policyCopy.equipment}</p> : null}
              </div>
            ) : null}
            {/* §9 precedence: safety first. */}
            <SafetyPanel bookingId={booking.id} />
            <RequirementChecklist bookingId={booking.id} active={isActive} gate={actionsQuery.data?.requirementGate ?? null} />
            <ExecutionSteps bookingId={booking.id} />
            {/* The service quality checklist "Mark complete" submits — server-matched item by item. */}
            {isInProgress ? (
              <CompletionChecklist
                bookingId={booking.id}
                checklist={checklist}
                ticked={ticked}
                onToggle={toggleItem}
                loading={executionQuery.isLoading}
              />
            ) : null}
            {/* §10: the recorded quality verdict (and why a complete was refused); §11: reported issues. */}
            <QualityPanel bookingId={booking.id} />
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
          </PartnerCard>

          <PartnerCard hover={false}>
            <p className="mb-3 text-sm font-semibold text-partner-text">Lifecycle</p>
            <ol className="space-y-3">
              {timeline.map(({ key, label, at, Icon }) => (
                <li key={key} className="flex items-center gap-3 text-sm">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      at ? "bg-partner-success/15 text-partner-success" : "bg-partner-bg text-partner-muted"
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

          <BookingRequestCard
            serverActions={actionsQuery.data ?? null}
            request={booking}
            completion={
              isInProgress
                ? { checklist, ticked, loading: executionQuery.isLoading, unavailable: executionQuery.isError }
                : undefined
            }
          />
        </div>

        <div className="space-y-6">
          <JobEvidencePanel bookingId={booking.id} />
          {showChat ? (
            <JobChatPanel
              bookingId={booking.id}
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
