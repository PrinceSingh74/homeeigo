import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Hammer, LifeBuoy, ListChecks, ShieldAlert, ShieldCheck } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { EscalationCard } from "@/components/EscalationCard";
import { ExecutionSteps } from "@/components/ExecutionSteps";
import { JobChatModal } from "@/components/JobChatModal";
import { JobLifecycleActions } from "@/components/JobLifecycleActions";
import { PartnerScreen } from "@/components/PartnerScreen";
import { QualityPanel } from "@/components/QualityPanel";
import { RequirementChecklist } from "@/components/RequirementChecklist";
import { SafetyPanel } from "@/components/SafetyPanel";
import { StartJobOtpSheet } from "@/components/StartJobOtpSheet";
import { Collapsible } from "@/components/job/Collapsible";
import { JobBrief } from "@/components/job/JobBrief";
import { JobEarnings } from "@/components/job/JobEarnings";
import { JobNoShow } from "@/components/job/JobNoShow";
import { JobPhotos } from "@/components/job/JobPhotos";
import { bringCount, hasBringList, JobBringList, RequirementLines } from "@/components/job/JobPreparation";
import { JobQuality } from "@/components/job/JobQuality";
import { JobStageRail } from "@/components/job/JobStageRail";
import { JobGone, JobLoadError, JobLoading, JobLocationBanner } from "@/components/job/JobStates";
import { usePhotoPicker } from "@/components/job/PhotoPicker";
import { ReasonSheet } from "@/components/job/ReasonSheet";
import { Banner, Button, Pill, T } from "@/components/ui";
import { jobActionsKey, refreshJob, useJobLifecycle } from "@/hooks/job/use-job-lifecycle";
import { useRealtimeFallbackInterval } from "@/hooks/use-partner-realtime";
import { usePartnerTrackingPublisher } from "@/hooks/use-partner-tracking-publisher";
import { BOOKING_LIST_FILTER, BOOKING_STATUS, bookingStatusLabel, isActiveWorkStatus, isClosedWithoutWorkStatus, isPendingStatus, normalizeBookingStatus } from "@/lib/booking-status";
import { CUSTOMER_CALL_UNAVAILABLE_NOTE } from "@/lib/customer-call";
import { setE2eGeoOverride } from "@/lib/e2e-geo";
import { EVIDENCE_MAX_PHOTOS_PER_UPLOAD, stagedPhotosFit } from "@/lib/evidence-photo";
import { followUpLine } from "@/lib/follow-up";
import { customerName } from "@/lib/format";
import { getAvailableJobActions, primaryActionLabel, primaryControlState } from "@/lib/job-action-policy";
import { canPartnerCancel, completionProof, failureSentence, isOfflineError, jobTerminalSummary, locationRefusal, OFFLINE_SENTENCE, photoStagesOpen, pickJobPolicy } from "@/lib/job-screen";
import { detailReadOf, isChatOpen, isJobGoneError, jobSubResourcesEnabled, resolveJobBooking, type StagePatch } from "@/lib/job-stage";
import { canCompleteConfirmation, confirmationRequired } from "@/lib/professional-confirmation";
import { canCompleteChecklist, toggleChecklistItem } from "@/lib/quality-checklist";
import { partnerApi } from "@/services/partner-api";
import { space, type Tone } from "@/theme/tokens";
import type { PartnerBooking } from "@/types/partner";
import type { PickedEvidence } from "@/components/job/PhotoPicker";

const JOBS_LIST = "/(tabs)/requests";

/** The same booking from a list cache the Requests tab keeps: a first-paint placeholder, nothing more. */
function listRowOf(caches: Array<{ bookings?: PartnerBooking[] } | undefined>, id: string): PartnerBooking | null {
  for (const cache of caches) {
    const hit = cache?.bookings?.find((b) => b.id === id);
    if (hit) return hit;
  }
  return null;
}

function statusTone(status: string): Tone {
  if (isPendingStatus(status)) return "warning";
  if (isActiveWorkStatus(status)) return "leaf";
  if (normalizeBookingStatus(status) === BOOKING_STATUS.COMPLETED) return "success";
  return "neutral";
}

/**
 * One job, from offer to earning.
 *
 * STATE. The fresh `GET /api/bookings/:id` answer is authoritative (`lib/job-stage.ts`): it is shown
 * exactly as sent — an arrival the server took back reads "not arrived" again — and a 404 means the
 * job is no longer this partner's ("This job is no longer yours", no live button). A list row is
 * only a first paint. After a lifecycle request the fields of the server's own answer are shown
 * while the detail is read again, and the request stays pending until it has been, so the stage
 * never flickers back.
 *
 * BUTTONS follow the server's `GET /api/bookings/:id/actions` (`availableActions`,
 * `disabledReasons`); the local mirror is the instant first paint and the fallback while the two
 * answers disagree (`pickJobPolicy`). The ONE action of the current stage is docked in the footer;
 * decline, cancel and "Customer not available?" are secondary.
 */
export function JobDetailScreen() {
  const { id, e2eLat, e2eLng } = useLocalSearchParams<{ id: string; e2eLat?: string; e2eLng?: string }>();
  const bookingId = Array.isArray(id) ? (id[0] ?? "") : (id ?? "");
  const qc = useQueryClient();
  const picker = usePhotoPicker();

  const [chatOpen, setChatOpen] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /**
   * The partner's ticks on the FROZEN service checklist, kept here so the Complete action sends
   * exactly what was ticked. `stillNeeded` is what the server named after a
   * `QUALITY_CHECKLIST_REQUIRED` refusal — those rows are unticked and flagged.
   */
  const [ticked, setTicked] = useState<string[]>([]);
  const [stillNeeded, setStillNeeded] = useState<string[]>([]);
  /** The professional's confirmation — ticked by the partner, never for them. */
  const [confirmed, setConfirmed] = useState(false);
  const [confirmationDemanded, setConfirmationDemanded] = useState(false);
  /** Completion photos picked and not yet sent: they travel once, with `/complete`. */
  const [stagedPhotos, setStagedPhotos] = useState<PickedEvidence[]>([]);
  /** Why the last completion photo was not staged (together they would not fit one request). */
  const [stagedProblem, setStagedProblem] = useState<string | null>(null);
  /** A tap already being handled: two taps in one frame both pass a state check, a ref stops the second. */
  const firing = useRef(false);
  /** The booking with the fields of a lifecycle answer applied, shown only while that request is in flight. */
  const [held, setHeld] = useState<PartnerBooking | null>(null);
  const shown = useRef<PartnerBooking | null>(null);

  useEffect(() => {
    setTicked([]);
    setStillNeeded([]);
    setConfirmed(false);
    setConfirmationDemanded(false);
    setStagedPhotos([]);
    setStagedProblem(null);
    setHeld(null);
  }, [bookingId]);

  useEffect(() => {
    const latRaw = Array.isArray(e2eLat) ? e2eLat[0] : e2eLat;
    const lngRaw = Array.isArray(e2eLng) ? e2eLng[0] : e2eLng;
    const lat = latRaw != null ? Number(latRaw) : NaN;
    const lng = lngRaw != null ? Number(lngRaw) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) setE2eGeoOverride(lat, lng);
  }, [e2eLat, e2eLng]);

  // X-56: GET /api/bookings/:id is the source of truth for every stage this screen shows (the
  // partner's access rule includes a SENT offer), and the only booking request it makes. The list
  // queries below READ the caches the Requests tab keeps (first paint) and never fetch from here.
  const detail = useQuery({
    queryKey: ["partner", "bookings", "by-id", bookingId],
    queryFn: () => partnerApi.getBooking(bookingId),
    enabled: !!bookingId,
    // A 404 is an answer ("not yours"), not a failure to retry.
    retry: (count, error) => !isJobGoneError(error) && count < 2,
  });
  const read = detailReadOf({ data: detail.data, error: detail.error });

  const pendingPollMs = useRealtimeFallbackInterval(10_000, 60_000);
  // The offer feed is the only source of the live offer window: fetched (and polled) only while this
  // job is an offer, or when the booking row cannot be read (an offer that just lapsed).
  const offerFeedNeeded = detail.isError || (detail.isSuccess && isPendingStatus(detail.data?.status));
  const pending = useQuery({
    queryKey: ["partner", "bookings", "pending"],
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.OFFERS, limit: 20, sortBy: "recent" }),
    enabled: offerFeedNeeded && read.kind !== "gone",
    // Safety net for the offer window; realtime events invalidate it immediately when connected.
    refetchInterval: offerFeedNeeded && read.kind !== "gone" ? pendingPollMs : false,
    refetchIntervalInBackground: false,
  });
  const activeList = useQuery({
    queryKey: ["partner", "bookings", "active"],
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.ACTIVE_WORK, limit: 20, sortBy: "upcoming" }),
    enabled: false,
  });
  const completedList = useQuery({
    queryKey: ["partner", "bookings", "completed"],
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.COMPLETED, limit: 20, sortBy: "recent" }),
    enabled: false,
  });

  const lifecycle = useJobLifecycle(bookingId, {
    onServerPatch: (patch: StagePatch) => setHeld(shown.current ? ({ ...shown.current, ...patch } as PartnerBooking) : null),
    onChecklistRefused: (needed) => {
      // Server truth wins: the items it says are missing go back to unticked, and are flagged.
      setTicked((prev) => prev.filter((i) => !needed.includes(i)));
      setStillNeeded(needed);
    },
    onConfirmationRefused: () => {
      setConfirmed(false);
      setConfirmationDemanded(true);
    },
    onCompleted: () => setStagedPhotos([]),
  });

  // After every render: the tap guard is released once no lifecycle request is in flight.
  const lifecycleBusy = lifecycle.busy;
  useEffect(() => {
    if (!lifecycleBusy) firing.current = false;
  });

  const resolved = resolveJobBooking({
    detail: read,
    listRow: listRowOf([activeList.data, completedList.data, pending.data], bookingId),
    hold: { booking: held, inFlight: lifecycle.busy },
  });
  const booking = resolved.booking;
  shown.current = booking;
  const clearHold = resolved.clearHold;
  useEffect(() => {
    if (clearHold) setHeld(null);
  }, [clearHold]);

  const status = booking?.status ?? null;
  const reads = jobSubResourcesEnabled(status);
  const active = booking != null && isActiveWorkStatus(status);
  const isOffer = booking != null && isPendingStatus(status);

  // The authority for the buttons, the gates and the no-show preview. 404 for an offer, so not asked then.
  const serverActions = useQuery({
    queryKey: jobActionsKey(bookingId),
    queryFn: () => partnerApi.getJobActions(bookingId),
    enabled: !!bookingId && active,
    staleTime: 15_000,
  });
  const evidence = useQuery({
    queryKey: ["partner", "job-evidence", bookingId],
    queryFn: () => partnerApi.listEvidence(bookingId),
    enabled: !!bookingId && booking != null && reads.evidence,
  });
  // Same query and cache as ExecutionSteps: the "What to bring" section also lists what the steps name.
  const execution = useQuery({
    queryKey: ["partner", "execution", bookingId],
    queryFn: () => partnerApi.getExecution(bookingId),
    enabled: !!bookingId && booking != null && reads.execution,
    staleTime: 10_000,
  });
  // What this job paid — the server's own lines, asked for only once the job is completed.
  const earning = useQuery({
    queryKey: ["partner", "job-earning", bookingId],
    queryFn: () => partnerApi.getBookingEarning(bookingId),
    enabled: !!bookingId && normalizeBookingStatus(status) === BOOKING_STATUS.COMPLETED,
    staleTime: 60_000,
  });
  // The masked number and whether a call is possible (it is not: there is no call relay for a partner).
  const contact = useQuery({
    queryKey: ["partner", "job-contact", bookingId],
    queryFn: () => partnerApi.getContact(bookingId),
    enabled: !!bookingId && active,
    staleTime: 60_000,
    retry: false,
  });

  // GPS publishing: committed, unfinished work only (IN_PROGRESS included, COMPLETED excluded).
  usePartnerTrackingPublisher({ bookingId: active ? bookingId : null, enabled: active });

  const mirror = getAvailableJobActions({
    status: status ?? "",
    scheduledDate: booking?.scheduledDate,
    enRouteAt: booking?.enRouteAt,
    arrivedAt: booking?.arrivedAt,
    startedAt: booking?.startedAt,
    completedAt: booking?.completedAt,
    paymentStatus: booking?.paymentStatus,
    // What only the server knows, from its last answer, so the mirror is as informed as it can be.
    requirementGate: serverActions.data?.requirementGate ?? null,
    safetyGate: serverActions.data?.safetyGate ?? null,
    paymentExempt: serverActions.data?.paymentExempt ?? booking?.paymentExempt === true,
    startOtpVerified: serverActions.data ? !serverActions.data.requiredGates.includes("START_OTP_VERIFIED") : undefined,
  });
  const picked = pickJobPolicy(active ? serverActions.data : null, mirror);
  const policy = picked.policy;
  /** The server's answer, only while it is for the booking on screen: gates, no-show preview, stage. */
  const serverAnswer = picked.source === "server" && active ? serverActions.data : undefined;
  // The cached `/actions` answer is for an older stage than the booking on screen: ask again — once
  // per detail answer (an answer newer than the detail is never asked for again, so a disagreement
  // that persists cannot become a refetch loop).
  const actionsStale = picked.stale && !serverActions.isFetching && serverActions.dataUpdatedAt < detail.dataUpdatedAt;
  const refetchActions = serverActions.refetch;
  useEffect(() => {
    if (actionsStale) void refetchActions();
  }, [actionsStale, refetchActions]);
  const refreshActions = useCallback(() => void refetchActions(), [refetchActions]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshJob(qc, bookingId);
    } finally {
      setRefreshing(false);
    }
  }, [qc, bookingId]);

  if (resolved.gone) {
    return (
      <PartnerScreen title="Job" showBack onBack={() => router.replace(JOBS_LIST)} refreshing={refreshing} onRefresh={() => void onRefresh()}>
        <JobGone />
      </PartnerScreen>
    );
  }

  if (!booking) {
    return (
      <PartnerScreen title="Job" showBack refreshing={refreshing} onRefresh={() => void onRefresh()}>
        {detail.isError ? <JobLoadError error={detail.error} onRetry={() => void detail.refetch()} retrying={detail.isFetching} /> : <JobLoading />}
      </PartnerScreen>
    );
  }

  const name = customerName(booking.customer);
  const jobStatus = normalizeBookingStatus(booking.status);
  const inProgress = jobStatus === BOOKING_STATUS.IN_PROGRESS;
  const notStartedYet = isOffer || (active && !inProgress);
  const closed = isClosedWithoutWorkStatus(booking.status);
  const terminal = jobTerminalSummary(booking.status, booking.cancellationReason);

  // The pending feed is the only source of the live offer window; it lists ONLY open offers.
  const pendingRow = pending.data?.bookings.find((b) => b.id === bookingId);
  // "Not in the feed" means "not an open offer" only if the feed was complete (not paginated away).
  const offerKnown = pending.isSuccess && (pending.data?.total ?? 0) <= (pending.data?.bookings.length ?? 0);

  // The frozen quality policy from GET /api/bookings/:id → execution.quality.
  const quality = booking.execution?.quality ?? null;
  const checklist: readonly string[] = quality?.checklist ?? [];
  const needsConfirmation = confirmationRequired(quality, confirmationDemanded);
  const proof = completionProof(quality, evidence.isSuccess ? evidence.data : null, stagedPhotos.length);

  // The primary action: the server's (or the mirror's) control state, then the three things the
  // server will check on a completion and the screen can see first — proof, checklist, confirmation.
  const primary = primaryControlState(policy);
  const completing = primary.action === "COMPLETE_SERVICE";
  const checklistGate = completing ? canCompleteChecklist(checklist, ticked) : null;
  const confirmationGate = completing ? canCompleteConfirmation(needsConfirmation, confirmed) : null;
  const completeHint = completing ? (!proof.ready ? proof.hint : checklistGate && !checklistGate.allowed ? checklistGate.hint : confirmationGate && !confirmationGate.allowed ? confirmationGate.hint : null) : null;
  const pinHint = primary.action === "START_SERVICE" && !primary.disabled && policy.requiredGates.includes("START_OTP_VERIFIED") ? "Ask the customer for the start PIN." : null;
  const primaryDisabled = primary.disabled || completeHint !== null;
  const primaryHint = primary.reason ?? completeHint ?? pinHint;

  function runPrimary() {
    if (lifecycle.busy || primaryDisabled || !booking) return;
    if (firing.current) return;
    // Held from this tap until the request it starts is no longer in flight (released below); the
    // PIN sheet starts no request here and has its own guard.
    firing.current = primary.action !== "START_SERVICE";
    switch (primary.action) {
      case "ACCEPT":
        // The booking's own server-computed ETA, or none. Never a number made up here.
        lifecycle.accept.mutate(booking.eta);
        break;
      case "START_NAVIGATION":
        lifecycle.enRoute.mutate();
        break;
      case "MARK_ARRIVED":
        lifecycle.arrived.mutate();
        break;
      case "START_SERVICE":
        setOtpOpen(true);
        break;
      case "COMPLETE_SERVICE":
        lifecycle.complete.mutate({ checklist, ticked, confirmationRequired: needsConfirmation, confirmed, photos: stagedPhotos.map((p) => p.dataUrl) });
        break;
      default:
        break;
    }
  }

  async function addCompletionPhoto() {
    const photo = await picker.pick({ title: "Add completion photo", note: proof.ask });
    if (!photo) return;
    if (stagedPhotos.length >= EVIDENCE_MAX_PHOTOS_PER_UPLOAD || stagedPhotos.some((p) => p.dataUrl === photo.dataUrl)) return;
    // They travel in one request: refuse here what the server would drop without an answer.
    const fit = stagedPhotosFit(stagedPhotos.map((p) => p.dataUrl), photo.dataUrl);
    if (!fit.ok) {
      setStagedProblem(fit.message);
      return;
    }
    setStagedProblem(null);
    setStagedPhotos((prev) => [...prev, photo]);
  }

  const chatAvailable = isChatOpen(booking.status);
  const phoneMasked = contact.data?.phoneMasked ?? booking.customer.phoneMasked ?? null;
  // No call button anywhere: the note says why, and points to chat (the server's `alternative`).
  const callNote = active && (contact.data ? !contact.data.canCall : true) ? CUSTOMER_CALL_UNAVAILABLE_NOTE : null;

  const safetyGate = serverAnswer?.safetyGate ?? null;
  const liveGateOk = serverAnswer?.requirementGate?.ok === true;
  const arrival = policy.stage === "ARRIVED" ? lifecycle.arrival : null;
  const followUp = followUpLine(booking.followUp);
  const cancellable = canPartnerCancel({ status: booking.status, serverStage: serverAnswer?.stage ?? null });
  const customerProvides = booking.requirements?.customerProvides ?? [];
  const preconditions = booking.requirements?.preconditions ?? [];
  const toBring = bringCount(booking);
  const showFooter = isOffer || (primary.action !== null && !closed);
  const stageKey = policy.stage;

  const footer = showFooter ? (
    <JobLifecycleActions
      action={primary.action}
      label={primaryActionLabel(primary.action)}
      disabled={primaryDisabled}
      hint={primaryHint}
      pendingAction={lifecycle.pendingAction}
      onPrimary={runPrimary}
      isOffer={isOffer}
      offer={pendingRow?.offer ?? null}
      offerKnown={offerKnown}
      onDecline={() => setDeclineOpen(true)}
    />
  ) : undefined;

  return (
    <PartnerScreen
      title={booking.service.name}
      subtitle={booking.bookingNumber}
      showBack
      headerAction={<Pill testID="job-status" label={bookingStatusLabel(booking.status, booking.arrivedAt)} tone={statusTone(booking.status)} />}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
      footer={footer}
    >
      {/* Keyed by booking: nothing typed, ticked or reported on one job carries over to another. */}
      <View key={booking.id} testID="job-detail-screen" style={styles.root}>
        {detail.isError ? (
          <Banner
            tone="warning"
            testID="job-stale"
            title={isOfflineError(detail.error) ? "You're offline" : "This job could not be refreshed"}
            message={isOfflineError(detail.error) ? `${OFFLINE_SENTENCE} What you see may be out of date.` : failureSentence(detail.error)}
            action={<Button label="Try again" variant="secondary" onPress={() => void detail.refetch()} loading={detail.isFetching} />}
          />
        ) : null}

        {terminal ? <Banner tone={terminal.tone} title={terminal.title} message={terminal.message} testID="job-terminal" /> : null}
        {lifecycle.resultMessage ? <Banner tone="info" message={lifecycle.resultMessage} testID="job-result-message" /> : null}

        {followUp ? (
          <Banner tone="info" testID="job-follow-up" title={followUp} message="The customer reported an issue with the earlier visit; this visit follows up on it." />
        ) : null}

        {isOffer ? (
          <Banner tone="info" testID="job-offer-notice" message="This job is offered to you and is not accepted yet. Steps, on-site checks and photos open once you accept." />
        ) : null}

        {safetyGate && !safetyGate.ok ? <Banner tone="danger" testID="job-safety-hold" title="Stop. Safety hold" message={safetyGate.message} /> : null}

        {/* Position refusals stay on screen until the partner acts: the server's sentence, never a toast. */}
        {lifecycle.locationIssue ? <JobLocationBanner issue={lifecycle.locationIssue} /> : null}
        {lifecycle.actionError ? <Banner tone="danger" message={lifecycle.actionError} testID="job-action-error" /> : null}
        {lifecycle.note ? <Banner tone="info" message={lifecycle.note} testID="job-location-note" /> : null}
        {stagedProblem ? <Banner tone="warning" message={stagedProblem} testID="job-photo-staged-problem" /> : null}
        {picker.recovered ? (
          <Banner tone="info" testID="job-photo-recovered" message="The app restarted while the camera was open. The photo you took was kept: tap the photo control again to use it." />
        ) : null}

        {/* What the arrival answer carried: the server's message, and the requirement gate to clear before starting. */}
        {arrival?.message ? <Banner tone="success" message={arrival.message} testID="job-arrival-recorded" /> : null}
        {arrival && arrival.gateLines.length > 0 && !liveGateOk ? (
          <Banner tone="warning" testID="job-arrival-gate" title="Before you can start" message={arrival.gateLines.join("\n")} />
        ) : null}

        <JobStageRail booking={booking} />

        <JobBrief booking={booking} phoneMasked={phoneMasked} callNote={callNote} chatAvailable={chatAvailable} onOpenChat={() => setChatOpen(true)} />

        <Collapsible
          key={`requirements-${stageKey}`}
          title="Requirements"
          icon={ShieldCheck}
          summary={serverAnswer?.requirementGate && !serverAnswer.requirementGate.ok ? serverAnswer.requirementGate.message : null}
          summaryTone="warning"
          defaultOpen={stageKey === "ARRIVED"}
          testID="job-preparation"
        >
          <RequirementLines title="Customer provides" items={customerProvides} />
          <RequirementLines title="Customer preconditions" items={preconditions} />
          {/* §6: the booking's own requirement state and the START gate belong to the partner who holds the job. */}
          {reads.requirements ? (
            <RequirementChecklist bookingId={booking.id} active={active} />
          ) : customerProvides.length === 0 && preconditions.length === 0 ? (
            <T kind="small">This offer records nothing the customer must provide or prepare.</T>
          ) : null}
        </Collapsible>

        {/* Materials and equipment in the server's words; the section is left out when it names none. */}
        {hasBringList(booking, execution.data?.steps) ? (
          <Collapsible
            key={`bring-${stageKey}`}
            title="What to bring"
            icon={Hammer}
            summary={toBring > 0 ? `${toBring} ${toBring === 1 ? "item" : "items"} listed` : null}
            defaultOpen={stageKey === "OFFERED" || stageKey === "ACCEPTED"}
            testID="job-bring"
          >
            <JobBringList booking={booking} steps={execution.data?.steps} />
          </Collapsible>
        ) : null}

        {reads.safety ? (
          <Collapsible
            key={`safety-${safetyGate?.ok === false ? "hold" : "clear"}`}
            title="Safety"
            icon={ShieldAlert}
            summary={safetyGate && !safetyGate.ok ? "Safety hold" : null}
            summaryTone="danger"
            defaultOpen={safetyGate?.ok === false}
            testID="job-safety"
          >
            <SafetyPanel bookingId={booking.id} />
          </Collapsible>
        ) : null}

        {reads.execution ? (
          <Collapsible key={`steps-${stageKey}`} title="Service steps" icon={ListChecks} defaultOpen={inProgress} testID="job-steps">
            <ExecutionSteps bookingId={booking.id} pickPhoto={picker.pick} />
          </Collapsible>
        ) : null}

        <JobQuality
          key={`quality-${inProgress ? "live" : "read"}`}
          quality={quality}
          inProgress={inProgress}
          notStartedYet={notStartedYet}
          ticked={ticked}
          stillNeeded={stillNeeded}
          onTick={(item) => {
            setTicked((prev) => toggleChecklistItem(checklist, prev, item));
            setStillNeeded((prev) => prev.filter((i) => i !== item));
          }}
          needsConfirmation={needsConfirmation}
          confirmed={confirmed}
          confirmationDemanded={confirmationDemanded}
          onToggleConfirmed={() => setConfirmed((prev) => !prev)}
          proof={proof}
          stagedPhotos={stagedPhotos.length}
          onAddCompletionPhoto={stagedPhotos.length < EVIDENCE_MAX_PHOTOS_PER_UPLOAD ? () => void addCompletionPhoto() : null}
        >
          {/* §10: the recorded verdict (and why a completion was refused); §11: reported issues. */}
          {reads.quality ? <QualityPanel bookingId={booking.id} /> : null}
        </JobQuality>

        {reads.evidence ? (
          <JobPhotos
            key={`photos-${inProgress ? "live" : "read"}`}
            bookingId={booking.id}
            evidence={evidence}
            openStages={active ? photoStagesOpen(policy.stage) : []}
            pickPhoto={picker.pick}
            staged={stagedPhotos}
            onAddCompletionPhoto={() => void addCompletionPhoto()}
            onRemoveStaged={(index) => {
              setStagedProblem(null);
              setStagedPhotos((prev) => prev.filter((_, i) => i !== index));
            }}
            proof={proof}
            defaultOpen={inProgress}
          />
        ) : null}

        {/* §52: secondary to Start, collapsed by default; drawn only from the server's `noShow` answer. */}
        {reads.actions || jobStatus === BOOKING_STATUS.CUSTOMER_NO_SHOW ? (
          <JobNoShow
            bookingId={booking.id}
            preview={serverAnswer?.noShow ?? null}
            fetchedAt={serverActions.dataUpdatedAt}
            refreshing={serverActions.isFetching}
            onRefresh={refreshActions}
            pickPhoto={picker.pick}
          />
        ) : null}

        {isOffer ? null : <JobEarnings status={booking.status} query={earning} />}

        <Collapsible title="Help and escalation" icon={LifeBuoy} testID="job-help">
          <EscalationCard bookingId={booking.id} enabled={reads.safety} />
        </Collapsible>

        {cancellable ? (
          <Button label="Cancel this job" variant="danger" onPress={() => setCancelOpen(true)} disabled={lifecycle.busy} testID="job-cancel" />
        ) : null}
      </View>

      {picker.sheet}

      <StartJobOtpSheet
        bookingId={booking.id}
        customerName={name}
        visible={otpOpen}
        onClose={() => setOtpOpen(false)}
        onStart={async (otp) => {
          try {
            await lifecycle.start.mutateAsync(otp);
          } catch (error) {
            // A position refusal is not about the PIN: close the sheet so the banner and
            // "Turn on location" on the job screen are in front of the partner.
            if (locationRefusal(error, false)) {
              setOtpOpen(false);
              return;
            }
            throw error;
          }
        }}
      />

      <JobChatModal
        bookingId={booking.id}
        status={booking.status}
        customerName={name}
        bookingNumber={booking.bookingNumber}
        phoneMasked={phoneMasked}
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
      />

      <ReasonSheet
        visible={cancelOpen}
        title="Cancel this job?"
        body="The customer is told and the job is taken off your list. Say why you cannot do it."
        confirmLabel="Cancel this job"
        keepLabel="Keep this job"
        onSubmit={(reason) => lifecycle.cancel.mutateAsync(reason)}
        onClose={() => setCancelOpen(false)}
        testID="job-cancel-sheet"
      />

      <ReasonSheet
        visible={declineOpen}
        title="Decline this job?"
        body="The job is offered to another partner. Say why you are declining it."
        confirmLabel="Decline job"
        keepLabel="Go back"
        onSubmit={async (reason) => {
          await lifecycle.decline.mutateAsync(reason);
          // Declined: there is nothing left to show here, and the job is no longer this partner's.
          router.replace(JOBS_LIST);
        }}
        onClose={() => setDeclineOpen(false)}
        testID="job-decline-sheet"
      />
    </PartnerScreen>
  );
}

const styles = StyleSheet.create({
  root: { gap: space.lg, paddingBottom: space.xxl },
});
