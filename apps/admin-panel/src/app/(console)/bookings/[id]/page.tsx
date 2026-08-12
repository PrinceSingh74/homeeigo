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
import { adminApi } from "@/services/admin-api";
import { formatDate, inr } from "@/lib/format";

type ActionType = "cancel" | "complete" | "dispatch" | "repair" | "refund" | null;

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [action, setAction] = useState<ActionType>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [providerId, setProviderId] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "booking", id],
    queryFn: () => adminApi.getBookingDetail(id),
    enabled: !!id,
  });
  // Support tickets raised on this booking (customer/partner disputes + chat).
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

  const cancelMut = useMutation({ mutationFn: (reason: string) => adminApi.adminCancelBooking(id, reason), onSuccess: () => { setAction(null); invalidate(); } });
  const completeMut = useMutation({ mutationFn: (reason: string) => adminApi.adminCompleteBooking(id, reason), onSuccess: () => { setAction(null); invalidate(); } });
  const dispatchMut = useMutation({ mutationFn: (reason: string) => adminApi.adminForceDispatch(id, reason), onSuccess: () => { setAction(null); invalidate(); } });
  const repairMut = useMutation({ mutationFn: (reason: string) => adminApi.adminRepairBooking(id, reason), onSuccess: () => { setAction(null); invalidate(); } });
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

  const timelineRows = timeline.map((e) => [
    new Date(e.at).toLocaleString(),
    <span key={e.at} className={`text-xs ${e.type === "admin" ? "text-amber-400" : ""}`}>{e.type}</span>,
    e.label,
    e.details ?? "—",
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
        <Link href="/bookings" className="rounded-lg border p-2 hover:bg-[var(--color-biz-elevated)]">
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
              <input type="datetime-local" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} className="flex-1 rounded-lg border bg-[var(--color-biz-bg)] px-2 py-1.5 text-sm" />
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

      <DataTable title="Dispatch attempts" headers={["Dispatched", "Provider", "Status", "Responded"]} rows={dispatchRows} loading={isLoading} emptyMessage="No dispatch attempts" />
      <DataTable title="Timeline" headers={["When", "Type", "Event", "Details"]} rows={timelineRows} loading={isLoading} emptyMessage="No events" />

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
        description="This will cancel the booking and may trigger refund processing."
        reasonLabel="Cancellation reason"
        reasonRequired
        destructive
        confirmLabel="Cancel booking"
        isLoading={isMutating}
        onClose={() => setAction(null)}
        onConfirm={(reason) => { if (reason) cancelMut.mutate(reason); }}
      />

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

      {action === "refund" && (
        <ConfirmDialog
          open
          title="Issue refund"
          description={`Enter refund amount (max ${inr(Number(booking.finalAmount ?? 0), true)})`}
          reasonLabel="Refund reason"
          reasonRequired
          confirmLabel="Process refund"
          isLoading={isMutating}
          onClose={() => setAction(null)}
          onConfirm={(reason) => {
            const amount = Number(refundAmount) || Number(booking.finalAmount ?? 0);
            if (reason) refundMut.mutate({ amount, reason });
          }}
        />
      )}
    </div>
  );
}
