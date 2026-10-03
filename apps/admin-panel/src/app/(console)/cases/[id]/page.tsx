"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  adminApi,
  ADMIN_CASE_TRANSITIONS,
  ADMIN_RESOLVE_ACTIONS,
  type AdminResolveAction,
} from "@/services/admin-api";
import { AdminApiError, getErrorMessage } from "@/lib/api-error";
import { inr } from "@/lib/format";

/** Mirror of backend RESOLVABLE_FROM (booking-case-policy): a case must be triaged before it is decided. */
const RESOLVABLE_FROM = ["TRIAGE", "ELIGIBILITY", "INVESTIGATION", "ACTION", "ESCALATED"] as const;

/** Phase 10 §11 — one case: lifecycle, evidence, eligibility, refunds, follow-ups and the two admin actions. */
export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const [transitionOpen, setTransitionOpen] = useState(false);
  const [transitionTo, setTransitionTo] = useState("");
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveAction, setResolveAction] = useState<AdminResolveAction | "">("");
  const [refundRupees, setRefundRupees] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin", "case", id],
    queryFn: () => adminApi.cases.detail(id),
    enabled: !!id,
    staleTime: 10_000,
    retry: 1,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "case", id] });
    void qc.invalidateQueries({ queryKey: ["admin", "cases"] });
  };

  const transitionMut = useMutation({
    mutationFn: (vars: { to: string; reason: string }) =>
      adminApi.cases.transition(id, { to: vars.to, reason: vars.reason, expectedVersion: data?.case.version }),
    onSuccess: () => {
      setTransitionOpen(false);
      setTransitionTo("");
      invalidate();
    },
  });

  const resolveMut = useMutation({
    mutationFn: (vars: {
      action: AdminResolveAction;
      reason: string;
      refundPaise?: number;
      scheduledDate?: string;
      overrideReason?: string;
    }) => adminApi.cases.resolve(id, { ...vars, expectedVersion: data?.case.version }),
    onSuccess: () => {
      setResolveOpen(false);
      setResolveAction("");
      setRefundRupees("");
      setScheduledDate("");
      setOverrideReason("");
      invalidate();
    },
  });

  const c = data?.case;
  const eligibility = data?.eligibilityNow;
  const isOpenCase = c ? c.state !== "RESOLVED" && c.state !== "REJECTED" : false;
  const transitionTargets = c ? (ADMIN_CASE_TRANSITIONS[c.state] ?? []) : [];
  const canResolve = c ? (RESOLVABLE_FROM as readonly string[]).includes(c.state) : false;

  const allowedNow: string[] = eligibility ? [...eligibility.allowedActions, "NONE"] : ["NONE"];
  const overrideActive = overrideReason.trim().length >= 3;
  const actionAllowedNow = (a: string) => allowedNow.includes(a) || overrideActive;

  const refundParsed = Number(refundRupees);
  const refundValid = Number.isFinite(refundParsed) && refundParsed > 0;
  const needsRefundAmount = resolveAction === "REFUND";
  const needsSchedule = resolveAction === "REWORK" || resolveAction === "INSPECTION";
  const resolveReady =
    resolveAction !== "" &&
    actionAllowedNow(resolveAction) &&
    (!needsRefundAmount || refundValid) &&
    (!needsSchedule || !!scheduledDate);

  const resolveErrorDetails =
    resolveMut.error instanceof AdminApiError && resolveMut.error.code === "ACTION_NOT_ALLOWED"
      ? ((resolveMut.error.details as unknown as { allowedActions?: string[] } | undefined)?.allowedActions ?? null)
      : null;

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center">
        <p className="text-lg font-bold">Couldn&apos;t load this case</p>
        <p className="mt-2 text-sm text-[var(--color-biz-muted)]">{getErrorMessage(error)}</p>
        <button type="button" onClick={() => void refetch()} className="biz-btn mt-4">Retry</button>
        <Link href="/cases" className="mt-3 block text-sm text-[var(--color-biz-muted)]">← Back to cases</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/cases" className="rounded-lg border p-2 hover:bg-[var(--color-biz-elevated)]" aria-label="Back to the case queue">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              {c ? c.case_number : isLoading ? "Loading…" : "Case"}
              {c ? <StatusBadge status={c.state} /> : null}
            </h1>
            <p className="text-sm text-[var(--color-biz-muted)]">
              {c ? c.type.replace(/_/g, " ") + " · " + c.category.replace(/_/g, " ").toLowerCase() + " · version " + c.version : "Case operations"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isOpenCase && transitionTargets.length > 0 ? (
            <button
              type="button"
              onClick={() => { setTransitionTo(""); setTransitionOpen(true); }}
              className="rounded-lg border px-3 py-1.5 text-sm"
              aria-label="Move this case to another state"
            >
              Transition
            </button>
          ) : null}
          {canResolve ? (
            <button
              type="button"
              onClick={() => { setResolveAction(""); setRefundRupees(""); setScheduledDate(""); setOverrideReason(""); setResolveOpen(true); }}
              className="rounded-lg bg-[var(--color-biz-accent)] px-3 py-1.5 text-sm font-semibold text-black"
              aria-label="Decide this case"
            >
              Decide case
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="biz-card space-y-2 p-4 text-sm">
          <h2 className="font-semibold">Booking</h2>
          {data?.booking ? (
            <>
              <p>
                <Link href={"/bookings/" + data.booking.id} className="underline">{data.booking.bookingNumber}</Link>
                {" · "}<StatusBadge status={data.booking.status} />
              </p>
              <p>Amount: {inr(Number(data.booking.totalAmount ?? 0), true)}</p>
              <p>Completed: {data.booking.completedAt ? new Date(data.booking.completedAt).toLocaleString() : "—"}</p>
              <p>
                Partner:{" "}
                {data.booking.providerId ? (
                  <Link href={"/vendors/" + data.booking.providerId} className="underline">{data.booking.providerId.slice(0, 12)}…</Link>
                ) : (
                  "—"
                )}
              </p>
            </>
          ) : (
            <p className="text-xs text-[var(--color-biz-muted)]">{isLoading ? "Loading…" : "—"}</p>
          )}
          {c?.description ? <p className="text-xs text-[var(--color-biz-muted)]">Customer says: &quot;{c.description}&quot;</p> : null}
          <p className="text-xs text-[var(--color-biz-muted)]">
            Reported {c ? new Date(c.created_at).toLocaleString() : "—"}
            {c?.sla_due_at ? " · triage SLA " + new Date(c.sla_due_at).toLocaleString() : ""}
            {c?.closed_at ? " · closed " + new Date(c.closed_at).toLocaleString() : ""}
          </p>
        </div>

        <div className="biz-card space-y-2 p-4 text-sm" data-testid="case-eligibility">
          <h2 className="font-semibold">Warranty eligibility (as of report)</h2>
          {eligibility ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                <StatusBadge status={eligibility.warrantyCovers ? "covered" : "not_covered"} />
                <StatusBadge status={eligibility.complaintWindowOpen ? "window_open" : "window_closed"} />
                {eligibility.proofRequired ? <StatusBadge status={eligibility.proofMissing ? "proof_missing" : "proof_present"} /> : null}
              </div>
              <p className="text-xs text-[var(--color-biz-muted)]">
                Reason codes: {eligibility.reasonCodes.length ? eligibility.reasonCodes.map((r) => r.replace(/_/g, " ").toLowerCase()).join(", ") : "—"}
              </p>
              <p className="text-xs text-[var(--color-biz-muted)]">
                Allowed actions: {eligibility.allowedActions.length ? eligibility.allowedActions.join(", ") + ", NONE" : "NONE"} — anything else needs a recorded override reason.
              </p>
            </>
          ) : (
            <p className="text-xs text-[var(--color-biz-muted)]">{isLoading ? "Loading…" : "—"}</p>
          )}
          {data?.warranty ? (
            <p className="text-xs text-[var(--color-biz-muted)]">
              Warranty row: <StatusBadge status={data.warranty.state} /> · {new Date(data.warranty.startsAt).toLocaleDateString()} → {new Date(data.warranty.expiresAt).toLocaleDateString()}
            </p>
          ) : (
            <p className="text-xs text-[var(--color-biz-muted)]">Warranty row: —</p>
          )}
          {c?.resolution ? (
            <p className="text-xs">
              Decision: {String((c.resolution as { action?: string }).action ?? "—")}
              {(c.resolution as { refundedPaise?: number }).refundedPaise != null
                ? " · refunded " + inr(Number((c.resolution as { refundedPaise: number }).refundedPaise) / 100, true)
                : ""}
              {(c.resolution as { followUpBookingId?: string }).followUpBookingId ? (
                <>
                  {" · follow-up "}
                  <Link href={"/bookings/" + (c.resolution as { followUpBookingId: string }).followUpBookingId} className="underline">
                    {String((c.resolution as { followUpBookingNumber?: string }).followUpBookingNumber ?? "booking")}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      <DataTable
        title="Evidence"
        headers={["Kind", "Note", "Actor", "Added", "Media"]}
        rows={(data?.evidence ?? []).map((e) => [
          e.kind.replace(/_/g, " ").toLowerCase(),
          e.note ?? (e.jobEvidenceId ? "job evidence " + e.jobEvidenceId.slice(0, 10) + "…" : "—"),
          (e.actorType ?? "—") + (e.actorId ? " " + e.actorId.slice(0, 10) + "…" : ""),
          new Date(e.createdAt).toLocaleString(),
          e.mediaUrl ? (
            <a key={"ev-" + e.id} href={e.mediaUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--color-biz-accent)] underline">
              View
            </a>
          ) : (
            "—"
          ),
        ])}
        loading={isLoading}
        emptyMessage="No evidence attached to this case"
      />

      <DataTable
        title="Refunds on this case"
        headers={["Refund", "Amount", "Status", "Created"]}
        rows={(data?.refunds ?? []).map((r) => [
          <span key={"rf-" + r.id} className="font-mono text-xs">{r.id.slice(0, 12)}…</span>,
          inr(Number(r.amount ?? 0), true),
          <StatusBadge key={"rfs-" + r.id} status={r.status} />,
          new Date(r.created_at).toLocaleString(),
        ])}
        loading={isLoading}
        emptyMessage="No refunds raised from this case"
      />

      <DataTable
        title="Follow-up visits"
        headers={["Booking", "Kind", "Status", "Scheduled", "Partner"]}
        rows={(data?.followUps ?? []).map((f) => [
          <Link key={"fu-" + f.id} href={"/bookings/" + f.id} className="underline">{f.booking_number}</Link>,
          f.booking_kind.replace(/_/g, " "),
          <StatusBadge key={"fus-" + f.id} status={f.status} />,
          new Date(f.scheduled_date).toLocaleString(),
          f.provider_id ? f.provider_id.slice(0, 12) + "…" : "—",
        ])}
        loading={isLoading}
        emptyMessage="No follow-up visit created from this case"
      />

      <DataTable
        title="Case timeline"
        headers={["When", "Action", "Change", "Actor", "Reason", "Request / trace"]}
        rows={(data?.events ?? []).map((e) => [
          new Date(e.created_at).toLocaleString(),
          e.action.replace(/_/g, " "),
          (e.from_state ?? "—") + " → " + e.to_state,
          (e.actor_type ?? "—") + (e.actor_id ? " " + e.actor_id.slice(0, 10) + "…" : ""),
          e.reason ?? "—",
          (e.request_id ?? "—") + " / " + (e.trace_id ?? "—"),
        ])}
        loading={isLoading}
        emptyMessage="No case events recorded"
      />

      <ConfirmDialog
        open={transitionOpen}
        title={c ? "Move case out of " + c.state.replace(/_/g, " ") : "Move case"}
        description="Between open states only — RESOLVED and REJECTED are reached through a decision, never a bare state change."
        confirmLabel="Move case"
        reasonLabel="Reason"
        reasonRequired
        isLoading={transitionMut.isPending}
        confirmDisabled={!transitionTo}
        onClose={() => setTransitionOpen(false)}
        onConfirm={(reason) => { if (reason && transitionTo) transitionMut.mutate({ to: transitionTo, reason }); }}
      >
        <label className="text-xs text-[var(--color-biz-muted)]" htmlFor="case-transition-to">
          New state
        </label>
        <select
          id="case-transition-to"
          aria-label="New case state"
          value={transitionTo}
          onChange={(e) => setTransitionTo(e.target.value)}
          disabled={transitionMut.isPending}
          className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-biz-accent)] disabled:opacity-60"
        >
          <option value="">Choose a state</option>
          {transitionTargets.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
          ))}
        </select>
        {transitionMut.error ? (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {getErrorMessage(transitionMut.error, "Transition failed")}
            {transitionMut.error instanceof AdminApiError && transitionMut.error.code === "CASE_VERSION_CONFLICT"
              ? " Close this dialog to reload the case."
              : ""}
          </p>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={resolveOpen}
        title="Decide this case"
        description="Records the decision and closes the case: a refund moves real money, REWORK/INSPECTION create a follow-up visit, REJECT closes with no remedy for the customer, NONE closes with no action."
        confirmLabel="Record decision"
        reasonLabel="Reason"
        reasonRequired
        destructive
        isLoading={resolveMut.isPending}
        confirmDisabled={!resolveReady}
        onClose={() => setResolveOpen(false)}
        onConfirm={(reason) => {
          if (!reason || resolveAction === "" || !resolveReady) return;
          resolveMut.mutate({
            action: resolveAction,
            reason,
            refundPaise: needsRefundAmount ? Math.round(refundParsed * 100) : undefined,
            scheduledDate: needsSchedule && scheduledDate ? new Date(scheduledDate).toISOString() : undefined,
            overrideReason: overrideActive ? overrideReason.trim() : undefined,
          });
        }}
      >
        <label className="text-xs text-[var(--color-biz-muted)]" htmlFor="case-resolve-action">
          Action
        </label>
        <select
          id="case-resolve-action"
          aria-label="Resolution action"
          value={resolveAction}
          onChange={(e) => setResolveAction(e.target.value as AdminResolveAction | "")}
          disabled={resolveMut.isPending}
          className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-biz-accent)] disabled:opacity-60"
        >
          <option value="">Choose an action</option>
          {ADMIN_RESOLVE_ACTIONS.map((a) => (
            <option key={a} value={a} disabled={!actionAllowedNow(a)}>
              {a}{allowedNow.includes(a) ? "" : overrideActive ? " (override)" : " (warranty does not allow — needs override)"}
            </option>
          ))}
        </select>

        {needsRefundAmount ? (
          <>
            <label className="mt-2 block text-xs text-[var(--color-biz-muted)]" htmlFor="case-refund-amount">
              Refund amount (₹) — the server re-validates against what is still refundable
            </label>
            <input
              id="case-refund-amount"
              type="number"
              inputMode="decimal"
              min={0.01}
              step={0.01}
              value={refundRupees}
              disabled={resolveMut.isPending}
              onChange={(e) => setRefundRupees(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-biz-accent)] disabled:opacity-60"
            />
            {refundRupees !== "" && !refundValid ? <p className="mt-1 text-xs text-red-400">Enter an amount above ₹0.</p> : null}
          </>
        ) : null}

        {needsSchedule ? (
          <>
            <label className="mt-2 block text-xs text-[var(--color-biz-muted)]" htmlFor="case-followup-date">
              {resolveAction === "REWORK" ? "Rework visit date" : "Inspection visit date"}
            </label>
            <input
              id="case-followup-date"
              type="datetime-local"
              value={scheduledDate}
              disabled={resolveMut.isPending}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-biz-accent)] disabled:opacity-60"
            />
          </>
        ) : null}

        <label className="mt-2 block text-xs text-[var(--color-biz-muted)]" htmlFor="case-override-reason">
          Override reason (only to take an action the warranty does not allow)
        </label>
        <textarea
          id="case-override-reason"
          aria-label="Override reason"
          value={overrideReason}
          disabled={resolveMut.isPending}
          onChange={(e) => setOverrideReason(e.target.value)}
          rows={2}
          placeholder="Leave empty unless overriding the warranty policy"
          className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-biz-accent)] disabled:opacity-60"
        />

        {resolveMut.error ? (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {getErrorMessage(resolveMut.error, "Decision failed")}
            {resolveErrorDetails ? " Allowed without override: " + resolveErrorDetails.join(", ") + "." : ""}
            {resolveMut.error instanceof AdminApiError && resolveMut.error.code === "CASE_VERSION_CONFLICT"
              ? " Close this dialog to reload the case."
              : ""}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
