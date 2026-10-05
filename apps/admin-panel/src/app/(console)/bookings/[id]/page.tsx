"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, MessageSquare, Truck, Wrench } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BookingLiveTracking } from "@/components/tracking/BookingLiveTracking";
import { adminApi, ADMIN_QUALITY_VERDICTS } from "@/services/admin-api";
import { formatDate, inr } from "@/lib/format";
import { matchingReasonLabel } from "@/lib/matching-reasons";
import { FrozenRules, presentRules, type FrozenRule } from "@/components/operations/FrozenRules";
import type { AdminQualityView } from "@/services/admin-api";

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const words = (s: string) => s.replace(/_/g, " ").toLowerCase();

/**
 * The frozen quality + cover policy as plain statements. Only rules that change something are
 * listed: `customerConfirmation` is stored but nothing reads it (the customer is always asked),
 * and a disabled warranty contributes no cover lines.
 */
function frozenQualityRules(policy: NonNullable<AdminQualityView["policy"]>): FrozenRule[] {
  const q = policy.quality;
  const w = policy.warranty;
  const proof = q ? [q.proofRequired ? "Proof of work required" : "", q.beforeAfterPhotos ? "Before and after photos required" : ""].filter(Boolean) : [];
  const cover = w?.enabled && (w.durationDays ?? 0) > 0;
  const remedy = w && cover ? [w.reworkFirst ? "A free rework is offered first" : "", w.refundAllowed ? "A refund may be decided" : "A refund is not available under this cover", w.proofRequired ? "The customer must attach proof to claim" : ""].filter(Boolean) : [];
  return presentRules([
    { label: "Completion checklist", audience: "Professional — completion gate", value: q?.checklist },
    { label: "Completion criteria", audience: "Professional + quality verdict", value: q?.completionCriteria },
    { label: "Proof at completion", audience: "Completion gate", value: proof },
    { label: "Professional confirmation", audience: "Completion gate", value: q?.professionalConfirmation ? "The professional must confirm the completion criteria were met before completing." : null },
    { label: "Customer confirmation window", audience: "Customer", value: q?.confirmationWindowHours ? `${q.confirmationWindowHours} hours, then confirmed automatically` : null },
    { label: "Warranty", audience: "Customer", value: w ? (cover ? `${days(w.durationDays!)} from ${w.startEvent === "CONFIRMATION" ? "customer confirmation" : "job completion"}` : null) : null },
    { label: "Issues covered", audience: "Case eligibility", value: cover ? (w?.eligibleIssueTypes ?? []).map(words) : null },
    { label: "Remedy", audience: "Case decision", value: remedy },
    { label: "Exclusions", audience: "Customer", value: cover ? w?.exclusions : null },
    { label: "Complaint window", audience: "Customer", value: w?.complaintWindowDays ? `${days(w.complaintWindowDays)} after completion` : null },
    { label: "Service guarantee", audience: "Customer — shown verbatim", value: w?.guarantee },
    { label: "Damage policy", audience: "Customer — shown verbatim", value: w?.damagePolicy },
  ]);
}

type StepDetail = { title: string; description?: string | null; estimatedMinutes?: number | null; ppe?: string[]; warnings?: string[]; materials?: string[]; equipment?: string[] };

/** The step title, with what the frozen plan says about doing it behind a disclosure so the table stays scannable. */
function StepCell({ step: s }: { step: StepDetail }) {
  const lists: [string, string[] | undefined][] = [
    ["Materials", s.materials],
    ["Equipment", s.equipment],
    ["Protective equipment", s.ppe],
    ["Warnings", s.warnings],
  ];
  const shown = lists.filter(([, v]) => v && v.length > 0);
  const minutes = s.estimatedMinutes ? `about ${s.estimatedMinutes} min` : null;
  if (shown.length === 0 && !s.description) {
    return (
      <span>
        {s.title}
        {minutes ? <span className="block text-xs text-[var(--color-biz-muted)]">{minutes}</span> : null}
      </span>
    );
  }
  return (
    <details className="max-w-[420px]">
      <summary className="cursor-pointer">
        {s.title}
        <span className="ml-2 text-xs text-[var(--color-biz-muted)]">{[minutes, "details"].filter(Boolean).join(" · ")}</span>
      </summary>
      <div className="mt-1.5 space-y-1 whitespace-normal text-xs text-[var(--color-biz-muted)]">
        {s.description ? <p>{s.description}</p> : null}
        {shown.map(([label, v]) => (
          <p key={label}>
            <span className="font-semibold text-[var(--color-biz-text)]">{label}:</span> {v!.join("; ")}
          </p>
        ))}
      </div>
    </details>
  );
}

type ActionType = "cancel" | "complete" | "dispatch" | "repair" | "refund" | null;

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [action, setAction] = useState<ActionType>(null);
  const [recheck, setRecheck] = useState<{ code: string; label: string } | null>(null);
  const [resetStep, setResetStep] = useState<{ code: string; title: string } | null>(null);
  const [releaseHold, setReleaseHold] = useState<{ id: number; condition: string } | null>(null);
  const [holdForm, setHoldForm] = useState<{ condition: string; reason: string } | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideVerdict, setOverrideVerdict] = useState("");
  const [diagOpen, setDiagOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [providerId, setProviderId] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "booking", id],
    queryFn: () => adminApi.getBookingDetail(id),
    enabled: !!id,
  });
  const { data: evidenceData } = useQuery({
    queryKey: ["admin", "booking-evidence", id],
    queryFn: () => adminApi.getBookingEvidence(id),
    enabled: !!id,
    staleTime: 30_000,
    retry: 1,
  });
  // Support tickets raised on this booking (customer/partner disputes + chat).
  // §6: requirement operations — items, state, START gate, append-only audit.
  const { data: requirementsData } = useQuery({
    queryKey: ["admin", "booking-requirements", id],
    queryFn: () => adminApi.getBookingRequirements(id),
    enabled: !!id,
    staleTime: 10_000,
  });

  // §9: safety operations — holds, open incidents, hold audit.
  const { data: safetyData } = useQuery({
    queryKey: ["admin", "booking-safety", id],
    queryFn: () => adminApi.getBookingSafety(id),
    enabled: !!id,
    staleTime: 10_000,
  });
  // §8: execution operations — steps, state, completion gate, step audit.
  const { data: executionData } = useQuery({
    queryKey: ["admin", "booking-execution", id],
    queryFn: () => adminApi.getBookingExecution(id),
    enabled: !!id,
    staleTime: 10_000,
  });

  // §10: quality operations — verdict history, completion row, warranty, completion audit.
  const { data: qualityData } = useQuery({
    queryKey: ["admin", "booking-quality", id],
    queryFn: () => adminApi.getBookingQuality(id),
    enabled: !!id,
    staleTime: 10_000,
  });
  // Phase 11: matching diagnostics — fetched only when the card is opened (re-runs the matcher, read-only).
  const { data: diagData, isFetching: diagFetching, error: diagError } = useQuery({
    queryKey: ["admin", "booking-matching-diagnostics", id],
    queryFn: () => adminApi.getBookingMatchingDiagnostics(id),
    enabled: !!id && diagOpen,
    staleTime: 30_000,
    retry: 1,
  });

  const { data: ticketsData } = useQuery({
    queryKey: ["admin", "booking-tickets", id],
    queryFn: () => adminApi.support.tickets({ bookingId: id, status: "all", limit: 10 }),
    enabled: !!id,
    staleTime: 30_000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "booking", id] });
    void qc.invalidateQueries({ queryKey: ["admin", "bookings"] });
  };

  const [refundPolicy, setRefundPolicy] = useState<"customer_policy" | "full">("customer_policy");
  const cancelMut = useMutation({ mutationFn: (reason: string) => adminApi.adminCancelBooking(id, reason, refundPolicy), onSuccess: () => { setAction(null); invalidate(); } });
  const completeMut = useMutation({ mutationFn: (reason: string) => adminApi.adminCompleteBooking(id, reason), onSuccess: () => { setAction(null); invalidate(); } });
  const dispatchMut = useMutation({ mutationFn: (reason: string) => adminApi.adminForceDispatch(id, reason), onSuccess: () => { setAction(null); invalidate(); } });
  const repairMut = useMutation({ mutationFn: (reason: string) => adminApi.adminRepairBooking(id, reason), onSuccess: () => { setAction(null); invalidate(); } });
  const releaseHoldMut = useMutation({
    mutationFn: (vars: { holdId: number; reason: string }) => adminApi.adminReleaseSafetyHold(id, vars.holdId, vars.reason),
    onSuccess: () => { setReleaseHold(null); void qc.invalidateQueries({ queryKey: ["admin", "booking-safety", id] }); },
  });
  const placeHoldMut = useMutation({
    mutationFn: (vars: { condition: string; reason: string }) => adminApi.adminPlaceSafetyHold(id, vars.condition, vars.reason),
    onSuccess: () => { setHoldForm(null); void qc.invalidateQueries({ queryKey: ["admin", "booking-safety", id] }); },
  });
  const resetStepMut = useMutation({
    mutationFn: (vars: { code: string; reason: string }) => adminApi.adminResetExecutionStep(id, vars.code, vars.reason),
    onSuccess: () => { setResetStep(null); void qc.invalidateQueries({ queryKey: ["admin", "booking-execution", id] }); },
  });
  const recheckMut = useMutation({
    mutationFn: (vars: { code: string; reason: string }) => adminApi.adminRecheckRequirement(id, vars.code, vars.reason),
    onSuccess: () => { setRecheck(null); void qc.invalidateQueries({ queryKey: ["admin", "booking-requirements", id] }); },
  });
  const overrideMut = useMutation({
    mutationFn: (vars: { verdict: string; reason: string }) => adminApi.adminOverrideQualityVerdict(id, vars.verdict, vars.reason),
    onSuccess: () => {
      setOverrideOpen(false);
      setOverrideVerdict("");
      void qc.invalidateQueries({ queryKey: ["admin", "booking-quality", id] });
    },
  });
  const refundMut = useMutation({
    mutationFn: ({ amount, reason }: { amount: number; reason: string }) => adminApi.adminRefundBooking(id, amount, reason),
    onSuccess: () => { setAction(null); invalidate(); },
  });
  const rescheduleMut = useMutation({
    mutationFn: ({ date, reason }: { date: string; reason: string }) => adminApi.adminRescheduleBooking(id, date, reason),
    onSuccess: invalidate,
  });
  const reassignMut = useMutation({
    mutationFn: ({ pid, reason }: { pid: string; reason: string }) => adminApi.adminReassignBooking(id, pid, reason),
    onSuccess: invalidate,
  });

  const detail = data as Record<string, unknown> | undefined;
  const booking = (detail?.booking ?? {}) as Record<string, unknown>;
  const timeline = (detail?.timeline ?? []) as Array<{ type: string; label: string; at: string; details?: string }>;
  const dispatchAttempts = (detail?.dispatchAttempts ?? []) as Array<Record<string, unknown>>;

  // Trigger-written, append-only history (backend booking_status_history): every status, partner,
  // payment and schedule change with who made it and why.
  type HistoryRow = {
    at: string;
    status: { from: string | null; to: string };
    provider: { from: string | null; to: string | null };
    payment: { from: string | null; to: string | null };
    schedule: { from: string; to: string } | null;
    actor: { type: string; id: string | null } | null;
    reason: string | null;
  };
  const history = (detail?.statusHistory ?? []) as HistoryRow[];
  const historyRows = history.map((h, i) => {
    const changes: string[] = [];
    if (h.status.from !== h.status.to) changes.push(`${h.status.from ?? "∅"} → ${h.status.to}`);
    if (h.provider.from !== h.provider.to) changes.push(`partner ${h.provider.from ?? "∅"} → ${h.provider.to ?? "∅"}`);
    if (h.payment.from !== h.payment.to) changes.push(`payment ${h.payment.from ?? "∅"} → ${h.payment.to ?? "∅"}`);
    if (h.schedule) changes.push(`rescheduled ${new Date(h.schedule.from).toLocaleString()} → ${new Date(h.schedule.to).toLocaleString()}`);
    return [
      new Date(h.at).toLocaleString(),
      <span key={`a${i}`} className="text-xs">{h.actor ? `${h.actor.type}${h.actor.id ? ` · ${h.actor.id.slice(-6)}` : ""}` : "unattributed"}</span>,
      changes.join("; ") || "created",
      h.reason ?? "—",
    ];
  });

  const timelineRows = timeline.map((e) => [
    new Date(e.at).toLocaleString(),
    <span key={e.at} className={`text-xs ${e.type === "admin" ? "text-amber-400" : ""}`}>{e.type}</span>,
    e.label,
    e.details ?? "—",
  ]);

  const evidence = evidenceData?.evidence ?? [];
  const evidenceRows = evidence.map((e) => [
    String(e.stage),
    e.capturedAt ? new Date(e.capturedAt).toLocaleString() : "—",
    e.isCurrent ? "current" : "superseded",
    e.mediaAccessUrl || e.mediaUrl ? (
      <a
        key={e.id}
        href={String(e.mediaAccessUrl || e.mediaUrl)}
        target="_blank"
        rel="noreferrer"
        className="text-[10px] text-[var(--color-biz-accent)]"
      >
        View
      </a>
    ) : (
      "—"
    ),
  ]);

  const dispatchRows = dispatchAttempts.map((a) => [
    new Date(String(a.dispatchedAt)).toLocaleString(),
    String((a.provider as { businessName?: string })?.businessName ?? a.providerId ?? "—"),
    String(a.status ?? "—"),
    a.respondedAt ? new Date(String(a.respondedAt)).toLocaleString() : "—",
  ]);

  const isMutating = cancelMut.isPending || completeMut.isPending || dispatchMut.isPending || repairMut.isPending || refundMut.isPending;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/bookings" aria-label="Back to bookings" className="rounded-lg border p-2 hover:bg-[var(--color-biz-elevated)]">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{String(booking.bookingNumber ?? id).slice(0, 20)}</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">Admin booking operations</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Status" value={String(booking.status ?? "—")} loading={isLoading} />
        <KpiCard label="Amount" value={inr(Number(booking.finalAmount ?? 0), true)} loading={isLoading} />
        <KpiCard label="Payment" value={String(booking.paymentStatus ?? "—")} loading={isLoading} />
        <KpiCard label="Scheduled" value={formatDate(booking.scheduledDate as string | null)} icon={Calendar} loading={isLoading} />
      </div>

      {/* Live partner oversight — same real-time pipeline the customer/partner apps use */}
      {booking.status ? (
        <BookingLiveTracking
          bookingId={id}
          status={String(booking.status)}
          partnerName={(booking.provider as { name?: string } | undefined)?.name ?? null}
        />
      ) : null}

      <div className="biz-card p-4 space-y-4">
        <h2 className="font-semibold">Admin actions</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setAction("cancel")} className="rounded-lg border border-red-400/50 px-3 py-1.5 text-sm text-red-400">Cancel</button>
          <button type="button" onClick={() => setAction("complete")} className="rounded-lg border px-3 py-1.5 text-sm">Mark complete</button>
          <button type="button" onClick={() => setAction("dispatch")} className="rounded-lg border px-3 py-1.5 text-sm inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Force dispatch</button>
          <button type="button" onClick={() => setAction("repair")} className="rounded-lg border px-3 py-1.5 text-sm inline-flex items-center gap-1"><Wrench className="h-3.5 w-3.5" /> Repair</button>
          <button type="button" onClick={() => setAction("refund")} className="rounded-lg border px-3 py-1.5 text-sm">Refund</button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 border-t border-[var(--color-biz-line)] pt-4">
          <div>
            <label className="text-xs text-[var(--color-biz-muted)]">Reschedule to</label>
            <div className="mt-1 flex gap-2">
              <input type="datetime-local" aria-label="Reschedule to" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} className="flex-1 rounded-lg border bg-[var(--color-biz-bg)] px-2 py-1.5 text-sm" />
              <button
                type="button"
                disabled={!rescheduleDate || rescheduleMut.isPending}
                onClick={() => rescheduleMut.mutate({ date: new Date(rescheduleDate).toISOString(), reason: "Admin reschedule" })}
                className="rounded-lg bg-[var(--color-biz-accent)] px-3 py-1.5 text-sm text-black disabled:opacity-50"
              >
                Reschedule
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--color-biz-muted)]">Reassign provider ID</label>
            <div className="mt-1 flex gap-2">
              <input value={providerId} onChange={(e) => setProviderId(e.target.value)} placeholder="Provider ID" className="flex-1 rounded-lg border bg-[var(--color-biz-bg)] px-2 py-1.5 text-sm font-mono" />
              <button
                type="button"
                disabled={!providerId || reassignMut.isPending}
                onClick={() => reassignMut.mutate({ pid: providerId, reason: "Admin reassignment" })}
                className="rounded-lg bg-[var(--color-biz-accent)] px-3 py-1.5 text-sm text-black disabled:opacity-50"
              >
                Reassign
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="biz-card p-4 space-y-2 text-sm">
          <h2 className="font-semibold">Customer & service</h2>
          <p>Customer: {(booking.user as { firstName?: string; lastName?: string })?.firstName} {(booking.user as { lastName?: string })?.lastName}</p>
          <p>Provider: {(booking.provider as { name?: string })?.name ?? "Unassigned"}</p>
          <p>Service: {(booking.service as { name?: string })?.name ?? "—"}</p>
          {Array.isArray(booking.addons) && booking.addons.length > 0 ? (
            <p>
              Add-ons:{" "}
              {(booking.addons as { name: string; price: number }[])
                .map((a) => `${a.name} (+₹${a.price})`)
                .join(", ")}
            </p>
          ) : null}
        </div>
        <div className="biz-card p-4 space-y-2 text-sm">
          <h2 className="font-semibold">Payment</h2>
          <p>Status: {String(booking.paymentStatus ?? "—")}</p>
          <p>Method: {String(booking.paymentMethod ?? "—")}</p>
          {(booking.payment as { razorpayPaymentId?: string })?.razorpayPaymentId && (
            <p className="font-mono text-xs">Razorpay: {(booking.payment as { razorpayPaymentId: string }).razorpayPaymentId}</p>
          )}
        </div>
      </div>

      {/* §6 — requirement operations: what the booking requires (from ITS snapshot), who owns it, its state and evidence, and the START gate. */}
      <div className="biz-card p-4 space-y-3" data-testid="admin-requirements">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Requirements</h2>
          {requirementsData ? (
            requirementsData.enforced ? (
              <StatusBadge status={requirementsData.gate.start.ok ? "GATE_OPEN" : "START_BLOCKED"} />
            ) : (
              <span className="text-xs text-[var(--color-biz-muted)]">Gate not deployed on this database (migration 20260924150000)</span>
            )
          ) : null}
        </div>
        {requirementsData?.enforced && !requirementsData.gate.start.ok ? (
          <p className="text-sm text-amber-500" role="status">
            START is blocked: {requirementsData.gate.start.blocking.map((b) => b.label + " (" + b.reason.replace(/_/g, " ").toLowerCase() + ")").join("; ")}
          </p>
        ) : null}
        <DataTable
          title=""
          headers={["Requirement", "Point", "Owner", "Verification", "State", "Evidence", "Policy version", "Action"]}
          rows={(requirementsData?.items ?? []).map((r) => [
            r.label,
            r.enforcementPoint.replace(/_/g, " "),
            r.responsibility,
            r.verification.replace(/_/g, " "),
            <StatusBadge key={"s-" + r.code} status={r.state} />,
            r.resolvedAt ? (r.resolvedByRole ?? "—") + " · " + new Date(r.resolvedAt).toLocaleString() + (r.note ? " · \"" + r.note + "\"" : "") : "—",
            String(requirementsData?.serviceVersion ?? "—"),
            r.actions.includes("RECHECK") ? (
              <button key={"a-" + r.code} type="button" onClick={() => setRecheck({ code: r.code, label: r.label })} className="rounded-lg border px-2 py-1 text-xs" aria-label={"Request a re-check of " + r.label}>
                Request re-check
              </button>
            ) : (
              "—"
            ),
          ])}
          loading={isLoading}
          emptyMessage={requirementsData?.enforced === false ? "Not enforced on this database" : "No gated requirements for this booking"}
        />
        <DataTable
          title="Requirement audit"
          headers={["When", "Requirement", "Action", "Change", "Actor", "Reason", "Request / trace"]}
          rows={(requirementsData?.audit ?? []).map((a) => [
            new Date(a.changedAt).toLocaleString(),
            a.code,
            a.action,
            (a.fromState ?? "—") + " → " + a.toState,
            (a.actorType ?? "—") + (a.actorId ? " " + a.actorId.slice(0, 10) + "…" : ""),
            a.reason ?? "—",
            (a.requestId ?? "—") + " / " + (a.traceId ?? "—"),
          ])}
          loading={isLoading}
          emptyMessage="No requirement changes recorded"
        />
      </div>

      {/* §9 — safety operations: holds block START / steps / COMPLETE until released here; incidents are resolved in the safety queue. */}
      <div className="biz-card p-4 space-y-3" data-testid="admin-safety">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Safety</h2>
          <div className="flex items-center gap-2">
            {safetyData ? <StatusBadge status={safetyData.gate.ok ? "SAFE_TO_PROCEED" : "SAFETY_HOLD"} /> : null}
            {safetyData?.holdsEnforced ? (
              <button type="button" onClick={() => setHoldForm(holdForm ? null : { condition: "", reason: "" })} className="rounded-lg border px-2 py-1 text-xs" aria-expanded={holdForm != null}>
                Place safety hold
              </button>
            ) : null}
          </div>
        </div>
        {safetyData && !safetyData.gate.ok ? <p className="text-sm text-red-400" role="status">{safetyData.gate.message}</p> : null}
        {/* The safety rules this booking was made under (its own safety.v1 snapshot); the professional sees all of them, the customer the ones marked so. */}
        {safetyData?.safety ? (
          <FrozenRules
            testId="admin-safety-frozen-rules"
            rules={[
              { label: "Do not proceed if", audience: "Professional — can raise a hold for these", value: safetyData.safety.prohibitedConditions },
              { label: "Warnings", audience: "Customer + professional", value: safetyData.safety.warnings },
              { label: "What the customer must do", audience: "Customer + professional", value: safetyData.safety.customerRequirements },
              { label: "What the professional must do", audience: "Professional", value: safetyData.safety.providerRequirements },
              { label: "Protective equipment", audience: "Professional", value: safetyData.safety.ppe },
              { label: "Chemical restrictions", audience: "Customer + professional", value: safetyData.safety.chemicalRestrictions },
              { label: "Safety information", audience: "Customer + professional", value: safetyData.safety.information },
              { label: "Medical disclaimer", audience: "Customer + professional", value: safetyData.safety.medicalDisclaimer },
              { label: "Emergency protocol", audience: "Customer + professional", value: safetyData.safety.emergencyProtocol },
              { label: "Incident protocol", audience: "Professional", value: safetyData.safety.incidentProtocol },
            ]}
            footnote="Frozen when the booking was made. A later change to the service does not alter these."
          />
        ) : null}
        {holdForm ? (
          <form
            className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end"
            onSubmit={(e) => { e.preventDefault(); placeHoldMut.mutate({ condition: holdForm.condition.trim(), reason: holdForm.reason.trim() }); }}
            aria-label="Place a safety hold"
          >
            <label className="text-xs space-y-1">
              <span className="block">Condition (shown to the professional and the customer)</span>
              <input value={holdForm.condition} onChange={(e) => setHoldForm({ ...holdForm, condition: e.target.value })} minLength={3} maxLength={200} required className="w-full rounded-lg border px-2 py-1 text-sm bg-transparent" />
            </label>
            <label className="text-xs space-y-1">
              <span className="block">Reason (internal, safety operations only)</span>
              <input value={holdForm.reason} onChange={(e) => setHoldForm({ ...holdForm, reason: e.target.value })} minLength={3} maxLength={300} required className="w-full rounded-lg border px-2 py-1 text-sm bg-transparent" />
            </label>
            <button type="submit" disabled={placeHoldMut.isPending || holdForm.condition.trim().length < 3 || holdForm.reason.trim().length < 3} className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50">
              {placeHoldMut.isPending ? "Placing…" : "Place hold"}
            </button>
            {placeHoldMut.isError ? <p className="text-sm text-red-400 sm:col-span-3" role="alert">Could not place the hold: {(placeHoldMut.error as Error).message}</p> : null}
          </form>
        ) : null}
        <DataTable
          title=""
          headers={["Condition", "Source", "State", "Raised", "Incident", "Note", "Release reason", "Action"]}
          rows={(safetyData?.holds ?? []).map((h) => [
            h.condition,
            h.source.replace(/_/g, " "),
            <StatusBadge key={"h-" + h.id} status={h.state} />,
            h.raisedByRole + " · " + new Date(h.raisedAt).toLocaleString(),
            h.incidentId ? <Link key={"i-" + h.id} href={"/trust-safety/incidents/" + h.incidentId} className="underline">{h.incidentId.slice(0, 10)}…</Link> : "—",
            h.note ?? "—",
            h.releaseReason ?? "—",
            h.state === "ACTIVE" ? (
              <button key={"r-" + h.id} type="button" onClick={() => setReleaseHold({ id: h.id, condition: h.condition })} className="rounded-lg border px-2 py-1 text-xs" aria-label={"Release safety hold " + h.condition}>Release hold</button>
            ) : "—",
          ])}
          loading={isLoading}
          emptyMessage="No safety holds on this booking"
        />
        <DataTable
          title="Safety audit"
          headers={["When", "Condition", "Action", "Change", "Actor", "Reason", "Request / trace"]}
          rows={(safetyData?.audit ?? []).map((a) => [
            new Date(a.changed_at).toLocaleString(), a.condition, a.action, (a.from_state ?? "—") + " → " + a.to_state, a.actor_type ?? "—", a.reason ?? "—", (a.request_id ?? "—") + " / " + (a.trace_id ?? "—"),
          ])}
          loading={isLoading}
          emptyMessage="No safety changes recorded"
        />
      </div>

      {/* §8 — execution operations: the booking's own frozen work plan, step state, evidence and audit. */}
      <div className="biz-card p-4 space-y-3" data-testid="admin-execution">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Work steps</h2>
          {executionData?.enforced && executionData.steps.length ? <StatusBadge status={executionData.gate.ok ? "STEPS_DONE" : "COMPLETION_BLOCKED"} /> : null}
        </div>
        <DataTable
          title=""
          headers={["#", "Step", "Kind", "Required", "Evidence", "State", "Finished", "Note / reason", "Action"]}
          rows={(executionData?.steps ?? []).map((s) => [
            String(s.stepNumber),
            <StepCell key={"sc-" + s.code} step={s} />,
            s.kind.replace(/_/g, " "),
            s.mandatory ? "Mandatory" : "Optional",
            s.evidence.replace(/_/g, " "),
            <StatusBadge key={"st-" + s.code} status={s.state} />,
            s.finishedAt ? new Date(s.finishedAt).toLocaleString() : "—",
            s.reason ?? s.note ?? "—",
            s.actions.includes("RESET") ? (
              <button key={"r-" + s.code} type="button" onClick={() => setResetStep({ code: s.code, title: s.title })} className="rounded-lg border px-2 py-1 text-xs" aria-label={"Reset step " + s.title}>
                Reset step
              </button>
            ) : "—",
          ])}
          loading={isLoading}
          emptyMessage={executionData?.enforced === false ? "Not enforced on this database" : "No work plan for this booking"}
        />
        <DataTable
          title="Step audit"
          headers={["When", "Step", "Action", "Change", "Actor", "Reason", "Evidence", "Request / trace"]}
          rows={(executionData?.audit ?? []).map((a) => [
            new Date(a.changed_at).toLocaleString(),
            a.code,
            a.action,
            (a.from_state ?? "—") + " → " + a.to_state,
            a.actor_type ?? "—",
            a.reason ?? "—",
            a.evidence_ref ?? "—",
            (a.request_id ?? "—") + " / " + (a.trace_id ?? "—"),
          ])}
          loading={isLoading}
          emptyMessage="No step changes recorded"
        />
      </div>

      {/* §10 — quality operations: append-only verdict history, the completion window and the ONE admin action (a superseding verdict with a reason). */}
      <div className="biz-card p-4 space-y-3" data-testid="admin-quality">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Quality</h2>
          <div className="flex items-center gap-2">
            {qualityData?.enforced && qualityData.latest ? <StatusBadge status={qualityData.latest.verdict} /> : null}
            {qualityData?.enforced ? (
              <button
                type="button"
                onClick={() => { setOverrideVerdict(""); setOverrideOpen(true); }}
                disabled={!qualityData.latest}
                title={!qualityData.latest ? "No verdict to supersede yet — one is derived at the first completion attempt" : undefined}
                className="rounded-lg border px-2 py-1 text-xs disabled:opacity-50"
                aria-label="Override the quality verdict"
              >
                Override verdict
              </button>
            ) : null}
          </div>
        </div>
        {qualityData && !qualityData.enforced ? (
          <p className="text-xs text-[var(--color-biz-muted)]">Quality verdicts are not deployed on this database</p>
        ) : null}
        {qualityData?.latest ? (
          <p className="text-sm" role="status">
            Latest verdict #{qualityData.latest.sequence}
            {qualityData.latest.reasonCodes.length ? " · " + qualityData.latest.reasonCodes.map((c) => c.replace(/_/g, " ").toLowerCase()).join(", ") : ""}
            {" · " + qualityData.latest.actorType + (qualityData.latest.actorId ? " " + qualityData.latest.actorId.slice(0, 10) + "…" : "")}
            {" · " + new Date(qualityData.latest.createdAt).toLocaleString()}
          </p>
        ) : null}
        <DataTable
          title="Verdict history"
          headers={["#", "Verdict", "Reason codes", "Actor", "Reason", "Supersedes", "When", "Request / trace"]}
          rows={(qualityData?.history ?? []).map((v) => [
            String(v.sequence),
            <StatusBadge key={"qv-" + v.id} status={v.verdict} />,
            v.reasonCodes.length ? v.reasonCodes.map((c) => c.replace(/_/g, " ").toLowerCase()).join(", ") : "—",
            v.actorType + (v.actorId ? " " + v.actorId.slice(0, 10) + "…" : ""),
            v.reason ?? "—",
            v.supersedesId != null ? "verdict " + v.supersedesId : "—",
            new Date(v.createdAt).toLocaleString(),
            (v.requestId ?? "—") + " / " + (v.traceId ?? "—"),
          ])}
          loading={isLoading}
          emptyMessage={qualityData?.enforced === false ? "Not deployed on this database" : "No verdicts recorded for this booking"}
        />
        {/* Completion window: PENDING_CUSTOMER → CONFIRMED / AUTO_CONFIRMED / ISSUE_REPORTED (case link). */}
        <div className="rounded-xl border border-[var(--color-biz-line)] p-3 text-sm space-y-1" data-testid="admin-completion">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Completion confirmation</span>
            {qualityData?.completion ? (
              <StatusBadge status={qualityData.completion.state} />
            ) : (
              <span className="text-xs text-[var(--color-biz-muted)]">No completion record{qualityData?.enforced === false ? " (not deployed on this database)" : ""}</span>
            )}
          </div>
          {qualityData?.completion ? (
            <>
              <p className="text-xs text-[var(--color-biz-muted)]">
                Requested {new Date(qualityData.completion.requestedAt).toLocaleString()} · customer confirm-by {new Date(qualityData.completion.confirmBy).toLocaleString()}
                {qualityData.completion.verdictId != null ? " · from verdict " + qualityData.completion.verdictId : ""}
              </p>
              <p className="text-xs text-[var(--color-biz-muted)]">
                Resolved:{" "}
                {qualityData.completion.resolvedAt
                  ? new Date(qualityData.completion.resolvedAt).toLocaleString() +
                    " by " + (qualityData.completion.resolvedByType ?? "—") +
                    (qualityData.completion.resolvedById ? " " + qualityData.completion.resolvedById.slice(0, 10) + "…" : "")
                  : "—"}
              </p>
              {qualityData.completion.state === "ISSUE_REPORTED" && qualityData.completion.caseId ? (
                <Link href={"/cases/" + qualityData.completion.caseId} className="text-xs text-[var(--color-biz-accent)] underline">
                  Open case {qualityData.completion.caseId.slice(0, 10)}…
                </Link>
              ) : null}
            </>
          ) : null}
          {qualityData?.warranty ? (
            <p className="text-xs text-[var(--color-biz-muted)]">
              Warranty: <StatusBadge status={qualityData.warranty.state} /> · {new Date(qualityData.warranty.startsAt).toLocaleDateString()} → {new Date(qualityData.warranty.expiresAt).toLocaleDateString()}
              {qualityData.warranty.voidReason ? " · void: " + qualityData.warranty.voidReason : ""}
            </p>
          ) : null}
        </div>
        {/* The quality and cover rules this booking froze — what an override or a complaint decision is judged against. Absent on an older backend: nothing is claimed. */}
        {qualityData?.policy ? (
          frozenQualityRules(qualityData.policy).length > 0 ? (
            <FrozenRules
              testId="admin-quality-frozen-rules"
              rules={frozenQualityRules(qualityData.policy)}
              footnote="Frozen when the booking was made. The customer is always asked to confirm the work after completion."
            />
          ) : (
            <p className="text-xs text-[var(--color-biz-muted)]">No quality or cover policy was frozen with this booking.</p>
          )
        ) : null}
        <DataTable
          title="Completion audit"
          headers={["When", "Action", "Change", "Verdict / case", "Actor", "Reason", "Request / trace"]}
          rows={(qualityData?.audit ?? []).map((a) => [
            new Date(a.changed_at).toLocaleString(),
            a.action,
            (a.from_state ?? "—") + " → " + a.to_state,
            (a.verdict_id != null ? "verdict " + a.verdict_id : "—") + (a.case_id ? " / case " + a.case_id.slice(0, 10) + "…" : ""),
            (a.actor_type ?? "—") + (a.actor_id ? " " + a.actor_id.slice(0, 10) + "…" : ""),
            a.reason ?? "—",
            (a.request_id ?? "—") + " / " + (a.trace_id ?? "—"),
          ])}
          loading={isLoading}
          emptyMessage="No completion changes recorded"
        />
      </div>

      {/* Phase 11 — matching diagnostics: re-runs the canonical matcher for this booking, read-only; fetched only when opened. */}
      <div className="biz-card p-4 space-y-3" data-testid="admin-matching-diagnostics">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Matching diagnostics</h2>
          <button
            type="button"
            onClick={() => setDiagOpen((v) => !v)}
            className="rounded-lg border px-2 py-1 text-xs"
            aria-expanded={diagOpen}
            aria-label={diagOpen ? "Hide matching diagnostics" : "Run matching diagnostics"}
          >
            {diagOpen ? "Hide" : "Run diagnostics"}
          </button>
        </div>
        {!diagOpen ? (
          <p className="text-xs text-[var(--color-biz-muted)]">
            Why this booking matched whom: re-runs the matcher with every provider the hard gates refused and the reason codes. Nothing is dispatched.
          </p>
        ) : diagFetching && !diagData ? (
          <p className="text-sm text-[var(--color-biz-muted)]" role="status">Running the matcher…</p>
        ) : diagError ? (
          <p className="text-sm text-red-400" role="alert">{diagError instanceof Error ? diagError.message : "Could not run matching diagnostics"}</p>
        ) : diagData ? (
          <>
            <p className="text-xs text-[var(--color-biz-muted)]">
              {diagData.candidateCount} candidates · {diagData.matches.length} matched · {diagData.rejections.length} rejected · {diagData.latencyMs} ms
              {" · capability mode " + diagData.serviceCapabilityMode}
              {diagData.jobLocated ? "" : " · job has no usable location"}
            </p>
            {Object.keys(diagData.counts).length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(diagData.counts).map(([reason, n]) => (
                  <span key={reason} className="rounded-full bg-[var(--color-biz-elevated)] px-2 py-0.5 text-[11px]" title={reason}>
                    {matchingReasonLabel(reason)} · {n}
                  </span>
                ))}
              </div>
            ) : null}
            <DataTable
              title="Matched providers"
              headers={["Provider", "Score", "Distance", "Unknown signals"]}
              rows={diagData.matches.map((m) => [
                <Link key={"m-" + m.providerId} href={"/vendors/" + m.providerId} className="underline">{m.providerId.slice(0, 12)}…</Link>,
                String(Math.round(m.totalScore * 100) / 100),
                m.distance == null ? "—" : String(Math.round(m.distance * 100) / 100),
                m.unknownSignals.length ? m.unknownSignals.join(", ") : "—",
              ])}
              emptyMessage="No provider passed the hard gates"
            />
            <DataTable
              title="Rejected candidates"
              headers={["Provider", "Reasons", "Details"]}
              rows={diagData.rejections.map((r) => [
                <Link key={"rj-" + r.providerId} href={"/vendors/" + r.providerId} className="underline">{r.providerId.slice(0, 12)}…</Link>,
                <span key={"rr-" + r.providerId} title={r.reasons.join(", ")}>{r.reasons.map(matchingReasonLabel).join(", ")}</span>,
                <span key={"rd-" + r.providerId} className="block max-w-[360px] truncate text-xs text-[var(--color-biz-muted)]" title={JSON.stringify(r.details)}>
                  {JSON.stringify(r.details)}
                </span>,
              ])}
              emptyMessage="No candidate was rejected"
            />
          </>
        ) : null}
      </div>

      <DataTable title="Dispatch attempts" headers={["Dispatched", "Provider", "Status", "Responded"]} rows={dispatchRows} loading={isLoading} emptyMessage="No dispatch attempts" />
      <DataTable title="Status history" headers={["When", "Actor", "Change", "Reason"]} rows={historyRows} loading={isLoading} emptyMessage="No recorded changes" />
      <DataTable title="Timeline" headers={["When", "Type", "Event", "Details"]} rows={timelineRows} loading={isLoading} emptyMessage="No events" />
      <DataTable
        title="Job evidence"
        headers={["Stage", "Captured", "State", ""]}
        rows={evidenceRows}
        emptyMessage="No job evidence uploaded yet"
      />

      {/* Support tickets raised on this booking — customer/partner communication + disputes */}
      <div className="biz-card p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <MessageSquare className="h-4 w-4 text-[var(--color-biz-accent)]" /> Support tickets on this booking
          {ticketsData?.total ? <span className="rounded-full bg-[var(--color-biz-elevated)] px-2 py-0.5 text-[11px] font-bold">{ticketsData.total}</span> : null}
        </h2>
        {ticketsData?.tickets?.length ? (
          <div className="space-y-2">
            {ticketsData.tickets.map((t) => (
              <Link key={t.id} href="/support" className="flex items-center justify-between gap-3 rounded-lg bg-[var(--color-biz-elevated)] px-3 py-2 transition hover:brightness-110">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.subject}</p>
                  <p className="text-[11px] text-[var(--color-biz-muted)]">
                    {t.ticketNumber} · {t.source === "partner" ? "raised by partner" : "raised by customer"}
                    {t.slaBreached ? " · SLA breached" : ""}
                  </p>
                </div>
                <StatusBadge status={t.status} />
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-biz-muted)]">No tickets on this booking. Customer ↔ partner talk via in-app call/SMS; if either raises a complaint it appears here and in Support Ops.</p>
        )}
      </div>

      <ConfirmDialog
        open={action === "cancel"}
        title="Cancel booking"
        description="Cancels through the same path as a customer cancellation: open offers close, the partner is notified, and any refund is issued automatically. Completed or already-cancelled bookings cannot be cancelled."
        reasonLabel="Cancellation reason"
        reasonRequired
        destructive
        confirmLabel="Cancel booking"
        isLoading={isMutating}
        onClose={() => setAction(null)}
        onConfirm={(reason) => { if (reason) cancelMut.mutate(reason); }}
      >
        <label className="mt-2 block text-xs font-semibold">
          Refund
          <select
            className="biz-input mt-1 w-full"
            value={refundPolicy}
            onChange={(e) => setRefundPolicy(e.target.value as "customer_policy" | "full")}
          >
            <option value="customer_policy">Published cancellation policy (as if the customer cancelled now)</option>
            <option value="full">Full refund of everything paid (platform-side reason)</option>
          </select>
        </label>
        {cancelMut.error ? (
          <p role="alert" className="mt-2 text-xs text-red-400">{cancelMut.error instanceof Error ? cancelMut.error.message : "Cancel failed"}</p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={action === "complete"}
        title="Mark booking complete"
        description="Force-complete bypasses normal provider workflow."
        reasonLabel="Reason"
        reasonRequired
        confirmLabel="Mark complete"
        isLoading={isMutating}
        onClose={() => setAction(null)}
        onConfirm={(reason) => { if (reason) completeMut.mutate(reason); }}
      />

      <ConfirmDialog
        open={action === "dispatch"}
        title="Force dispatch"
        description="Re-runs the assignment engine for this booking."
        reasonLabel="Reason"
        reasonRequired
        confirmLabel="Dispatch now"
        isLoading={isMutating}
        onClose={() => setAction(null)}
        onConfirm={(reason) => { if (reason) dispatchMut.mutate(reason); }}
      />

      <ConfirmDialog
        open={action === "repair"}
        title="Repair booking"
        description="Repairs corrupted provider assignment or re-runs dispatch."
        reasonLabel="Reason"
        reasonRequired
        confirmLabel="Repair"
        isLoading={isMutating}
        onClose={() => setAction(null)}
        onConfirm={(reason) => { if (reason) repairMut.mutate(reason); }}
      />

      <ConfirmDialog
        open={releaseHold != null}
        title={releaseHold ? "Release safety hold \"" + releaseHold.condition + "\"" : "Release safety hold"}
        description="Only release when the hazard is confirmed cleared. Any linked incident must still be resolved in the safety queue before work can continue."
        confirmLabel="Release hold"
        destructive
        reasonLabel="Reason"
        reasonRequired
        isLoading={releaseHoldMut.isPending}
        onClose={() => setReleaseHold(null)}
        onConfirm={(reason) => { if (reason && releaseHold) releaseHoldMut.mutate({ holdId: releaseHold.id, reason }); }}
      />

      <ConfirmDialog
        open={resetStep != null}
        title={resetStep ? "Reset step \"" + resetStep.title + "\"" : "Reset step"}
        description="The step goes back to not-started so the professional can attempt it again. Nothing here can mark a step done."
        confirmLabel="Reset step"
        reasonLabel="Reason"
        reasonRequired
        isLoading={resetStepMut.isPending}
        onClose={() => setResetStep(null)}
        onConfirm={(reason) => { if (reason && resetStep) resetStepMut.mutate({ code: resetStep.code, reason }); }}
      />

      <ConfirmDialog
        open={recheck != null}
        title={recheck ? "Request a re-check of \"" + recheck.label + "\"" : "Request a re-check"}
        description="The requirement goes back to UNRESOLVED and the assigned professional must check it again on site. Nothing here can mark a requirement satisfied."
        confirmLabel="Request re-check"
        reasonLabel="Reason"
        reasonRequired
        isLoading={recheckMut.isPending}
        onClose={() => setRecheck(null)}
        onConfirm={(reason) => { if (reason && recheck) recheckMut.mutate({ code: recheck.code, reason }); }}
      />

      <ConfirmDialog
        open={overrideOpen}
        title="Override quality verdict"
        description="Appends a new ADMIN verdict that supersedes the latest one. History is never edited; a blocking verdict on a job still in progress stays in force until an admin supersedes it."
        confirmLabel="Record verdict"
        reasonLabel="Reason"
        reasonRequired
        destructive
        isLoading={overrideMut.isPending}
        confirmDisabled={!overrideVerdict}
        onClose={() => setOverrideOpen(false)}
        onConfirm={(reason) => { if (reason && overrideVerdict) overrideMut.mutate({ verdict: overrideVerdict, reason }); }}
      >
        <label className="text-xs text-[var(--color-biz-muted)]" htmlFor="admin-override-verdict">
          New verdict
        </label>
        <select
          id="admin-override-verdict"
          aria-label="New quality verdict"
          value={overrideVerdict}
          onChange={(e) => setOverrideVerdict(e.target.value)}
          disabled={overrideMut.isPending}
          className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-biz-accent)] disabled:opacity-60"
        >
          <option value="">Choose a verdict</option>
          {ADMIN_QUALITY_VERDICTS.map((v) => (
            <option key={v} value={v}>{v.replace(/_/g, " ")}</option>
          ))}
        </select>
        {overrideMut.error ? (
          <p role="alert" className="mt-2 text-xs text-red-400">{overrideMut.error instanceof Error ? overrideMut.error.message : "Override failed"}</p>
        ) : null}
      </ConfirmDialog>

      {action === "refund" && (() => {
        const maxRefundable = Number(booking.finalAmount ?? 0);
        const parsed = Number(refundAmount);
        const amountValid = Number.isFinite(parsed) && parsed > 0 && parsed <= maxRefundable + 0.005;
        return (
          <ConfirmDialog
            open
            title="Issue refund"
            description={`Full or partial refund (max ${inr(maxRefundable, true)}). The server re-validates against what was actually paid and already refunded.`}
            reasonLabel="Refund reason"
            reasonRequired
            confirmLabel="Process refund"
            isLoading={isMutating}
            confirmDisabled={!amountValid}
            onClose={() => {
              setAction(null);
              setRefundAmount("");
            }}
            onConfirm={(reason) => {
              if (!reason || !amountValid) return;
              refundMut.mutate({ amount: Math.round(parsed * 100) / 100, reason });
            }}
          >
            <label className="text-xs text-[var(--color-biz-muted)]" htmlFor="admin-refund-amount">
              Refund amount (₹)
            </label>
            <input
              id="admin-refund-amount"
              type="number"
              inputMode="decimal"
              min={0.01}
              max={maxRefundable}
              step={0.01}
              value={refundAmount}
              disabled={isMutating}
              onChange={(e) => setRefundAmount(e.target.value)}
              placeholder={String(maxRefundable)}
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-biz-accent)] disabled:opacity-60"
            />
            {refundAmount !== "" && !amountValid ? (
              <p className="mt-1 text-xs text-red-400">Enter an amount between ₹0.01 and {inr(maxRefundable, true)}.</p>
            ) : null}
          </ConfirmDialog>
        );
      })()}
    </div>
  );
}
