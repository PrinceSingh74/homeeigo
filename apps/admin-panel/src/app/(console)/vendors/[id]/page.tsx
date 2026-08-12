"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, BadgeCheck, BadgeX, Star, Phone, Mail, MapPin, Clock,
  Wallet, TrendingUp, ShieldCheck, FileText, Bike, Activity, CircleDot, Headphones,
} from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { adminApi, type ProviderDetail } from "@/services/admin-api";
import { useVerifyProviderMutation } from "@/hooks/use-admin-data";
import { formatDate, inr } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";

const AdminLiveTrackingMap = dynamic(
  () => import("@/components/tracking/AdminLiveTrackingMap").then((m) => m.AdminLiveTrackingMap),
  { ssr: false, loading: () => <div className="h-64 w-full rounded-xl bg-[var(--color-biz-elevated)]" aria-hidden /> },
);

const pct = (n: number | null | undefined) => `${Math.round(((n ?? 0) as number))}%`;
const relTime = (iso: string | null) => {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

export default function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<"approve" | "reject" | null>(null);
  const [mutErr, setMutErr] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin", "provider-detail", id],
    queryFn: () => adminApi.getProviderDetail(id),
    enabled: !!id,
    refetchInterval: 20_000, // keep live-location + status fresh
  });
  // This partner's support tickets (communication + escalations).
  const { data: ticketsData } = useQuery({
    queryKey: ["admin", "provider-tickets", id],
    queryFn: () => adminApi.support.tickets({ providerId: id, status: "all", limit: 8 }),
    enabled: !!id,
    staleTime: 30_000,
  });
  const verifyMut = useVerifyProviderMutation();

  const d = data as ProviderDetail | undefined;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="biz-skeleton h-8 w-64 rounded-lg" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="biz-skeleton h-28 rounded-2xl" />)}
        </div>
        <div className="biz-skeleton h-72 rounded-2xl" />
      </div>
    );
  }
  if (isError || !d) {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center">
        <p className="text-lg font-bold">Couldn&apos;t load this partner</p>
        <button type="button" onClick={() => void refetch()} className="biz-btn mt-4">Retry</button>
        <Link href="/vendors" className="mt-3 block text-sm text-[var(--color-biz-muted)]">← Back to vendors</Link>
      </div>
    );
  }

  const online = d.status.isOnline;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/vendors" className="mt-1 rounded-lg border border-[var(--color-biz-line)] p-2 transition hover:bg-[var(--color-biz-elevated)]">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-3">
            <div className="grid size-14 place-items-center rounded-2xl bg-[var(--color-biz-accent-dim)] text-lg font-bold text-[var(--color-biz-accent)]">
              {d.profile.name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{d.profile.name}</h1>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${online ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-500/15 text-[var(--color-biz-muted)]"}`}>
                  <CircleDot className="h-3 w-3" /> {online ? "Online" : "Offline"}
                </span>
              </div>
              <p className="text-sm text-[var(--color-biz-muted)]">
                {d.profile.businessName ? `${d.profile.businessName} · ` : ""}
                <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-amber-400 text-amber-400" />{(d.metrics.rating ?? 0).toFixed(2)}</span>
                {d.profile.city ? ` · ${d.profile.city}` : ""}
                {` · ${d.profile.serviceCategories.length} services`}
              </p>
              <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--color-biz-muted)]">
                {d.profile.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{d.profile.email}</span> : null}
                {d.profile.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{d.profile.phone}</span> : null}
                <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />joined {formatDate(d.profile.memberSince)}</span>
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!d.verification.isApproved ? (
            <button type="button" onClick={() => setConfirm("approve")} disabled={verifyMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60">
              <BadgeCheck className="h-4 w-4" /> Approve partner
            </button>
          ) : (
            <button type="button" onClick={() => setConfirm("reject")} disabled={verifyMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-500/10 disabled:opacity-60">
              <BadgeX className="h-4 w-4" /> Revoke approval
            </button>
          )}
        </div>
      </div>

      {mutErr ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{mutErr}</div> : null}

      {/* ── Top KPI strip ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={TrendingUp} label="Total earnings" value={inr(d.earnings.totalEarnings, true)} sub={`Wallet ${inr(d.earnings.walletBalance, true)}`} />
        <StatTile icon={Activity} label="Jobs completed" value={`${d.metrics.completedBookings}`} sub={`${d.metrics.totalBookings} lifetime · ${d.metrics.rejectedBookings} rejected`} />
        <StatTile icon={ShieldCheck} label="Acceptance rate" value={pct(d.metrics.acceptanceRate)} sub={`Response ${pct(d.metrics.responseRate)}`} accent={d.metrics.acceptanceRate >= 80 ? "green" : d.metrics.acceptanceRate >= 50 ? "amber" : "red"} />
        <StatTile icon={Wallet} label="Pending payout" value={inr(d.earnings.pendingPayoutAmount, true)} sub={`${d.earnings.pendingPayoutCount} request(s)`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        {/* ── LEFT column ── */}
        <div className="space-y-6">
          {/* Performance meters */}
          <section className="biz-card p-5">
            <h2 className="mb-4 flex items-center gap-2 font-semibold"><Activity className="h-4 w-4 text-[var(--color-biz-accent)]" /> Performance</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Meter label="Acceptance rate" value={d.metrics.acceptanceRate} />
              <Meter label="Response rate" value={d.metrics.responseRate} />
              <Meter label="Completion rate" value={d.metrics.completionRate} />
              <Meter label="On-time rate" value={d.metrics.onTimeRate} />
              <Meter label="Cancellation rate" value={d.metrics.cancellationRate} invert />
              <div className="rounded-xl bg-[var(--color-biz-elevated)] p-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">Avg response</p>
                <p className="mt-1 text-lg font-bold">{d.metrics.avgResponseTime != null ? `${Math.round(d.metrics.avgResponseTime)}s` : "—"}</p>
                <p className="text-[11px] text-[var(--color-biz-muted)]">{d.metrics.totalReviews} reviews · ★ {(d.metrics.rating ?? 0).toFixed(2)}</p>
              </div>
            </div>
          </section>

          {/* Accept / reject dispatch history */}
          <section className="biz-card p-5">
            <h2 className="mb-4 flex items-center gap-2 font-semibold"><Bike className="h-4 w-4 text-[var(--color-biz-accent)]" /> Job accept / reject history</h2>
            <DataTable
              headers={["When", "Booking", "Service", "Decision", "Response"]}
              rows={d.dispatchHistory.map((a) => [
                <span key={`t-${a.id}`} className="whitespace-nowrap text-xs text-[var(--color-biz-muted)]">{relTime(a.dispatchedAt)}</span>,
                <span key={`b-${a.id}`} className="whitespace-nowrap font-mono text-[11px]">{a.bookingNumber ?? "—"}</span>,
                <span key={`s-${a.id}`} className="block max-w-[160px] truncate text-xs" title={a.serviceName ?? undefined}>{a.serviceName ?? "—"}</span>,
                <DispatchBadge key={`d-${a.id}`} status={a.status} />,
                <span key={`r-${a.id}`} className="text-xs text-[var(--color-biz-muted)]">{a.responseMs != null ? `${(a.responseMs / 1000).toFixed(1)}s` : "—"}</span>,
              ])}
              emptyMessage="No dispatch history yet."
            />
          </section>

          {/* Recent bookings */}
          <section className="biz-card p-5">
            <h2 className="mb-4 flex items-center gap-2 font-semibold"><FileText className="h-4 w-4 text-[var(--color-biz-accent)]" /> Recent bookings</h2>
            <DataTable
              headers={["Booking", "Service", "Amount", "Status", "Scheduled"]}
              rows={d.recentBookings.map((b) => [
                <Link key={`bk-${b.id}`} href={`/bookings/${b.id}`} className="font-mono text-[11px] text-[var(--color-biz-accent)] hover:underline">{b.bookingNumber ?? b.id.slice(0, 8)}</Link>,
                <span key={`sv-${b.id}`} className="block max-w-[180px] truncate text-xs" title={b.serviceName ?? undefined}>{b.serviceName ?? "—"}</span>,
                <span key={`am-${b.id}`}>{inr(b.amount ?? 0)}</span>,
                <StatusBadge key={`st-${b.id}`} status={b.status.toLowerCase()} />,
                <span key={`sc-${b.id}`} className="text-xs text-[var(--color-biz-muted)]">{formatDate(b.scheduledDate)}</span>,
              ])}
              emptyMessage="No bookings yet."
            />
          </section>
        </div>

        {/* ── RIGHT column ── */}
        <div className="space-y-6">
          {/* Live location */}
          <section className="biz-card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><MapPin className="h-4 w-4 text-[var(--color-biz-accent)]" /> Live location</h2>
            {d.location ? (
              <>
                <AdminLiveTrackingMap provider={{ lat: d.location.latitude, lng: d.location.longitude }} riderLabel={d.profile.name} routeEnabled={false} className="h-64 w-full" />
                <p className="mt-2 text-xs text-[var(--color-biz-muted)]">
                  {d.location.latitude.toFixed(4)}, {d.location.longitude.toFixed(4)} · updated {relTime(d.location.updatedAt)}
                </p>
              </>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-xl bg-[var(--color-biz-elevated)] text-sm text-[var(--color-biz-muted)]">No location on record</div>
            )}
          </section>

          {/* Verification & KYC */}
          <section className="biz-card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-[var(--color-biz-accent)]" /> Verification & KYC</h2>
            <div className="space-y-2 text-sm">
              <Row label="Approval"><StatusBadge status={d.verification.isApproved ? "approved" : "pending"} /></Row>
              <Row label="KYC verified"><StatusBadge status={d.verification.isVerified ? "verified" : "pending"} /></Row>
              <Row label="Background check"><span className="text-xs">{d.verification.backgroundCheckStatus ?? "—"}</span></Row>
              <Row label="Registration"><span className="text-xs">{d.verification.registrationStatus ?? "—"}</span></Row>
              <Row label="PAN"><span className="font-mono text-xs">{d.verification.kyc.panNumber ?? "—"}</span></Row>
              <Row label="Aadhaar"><span className="font-mono text-xs">{d.verification.kyc.aadharNumber ?? "—"}</span></Row>
              {d.verification.verificationNotes ? <p className="rounded-lg bg-[var(--color-biz-elevated)] p-2 text-xs text-[var(--color-biz-muted)]">{d.verification.verificationNotes}</p> : null}
            </div>
            {d.verification.documents.length ? (
              <div className="mt-3 space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">Documents ({d.verification.documents.length})</p>
                {d.verification.documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between rounded-lg bg-[var(--color-biz-elevated)] px-3 py-1.5 text-xs">
                    <span>{doc.name ?? doc.type}</span>
                    <StatusBadge status={doc.isVerified ? "verified" : "pending"} />
                  </div>
                ))}
              </div>
            ) : <p className="mt-3 text-xs text-[var(--color-biz-muted)]">No documents uploaded.</p>}
          </section>

          {/* Earnings & payout */}
          <section className="biz-card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4 text-[var(--color-biz-accent)]" /> Earnings & payout</h2>
            <div className="space-y-2 text-sm">
              <Row label="This month"><span className="font-semibold">{inr(d.earnings.thisMonthEarnings, true)}</span></Row>
              <Row label="This week"><span className="font-semibold">{inr(d.earnings.thisWeekEarnings, true)}</span></Row>
              <Row label="Wallet balance"><span className="font-semibold">{inr(d.earnings.walletBalance, true)}</span></Row>
              <Row label="Commission rate"><span>{d.earnings.commissionRate != null ? `${d.earnings.commissionRate}%` : "—"}</span></Row>
              <div className="my-2 border-t border-[var(--color-biz-line)]" />
              <Row label="Bank"><span className="text-xs">{d.earnings.bank.bankName ?? "—"}</span></Row>
              <Row label="Account"><span className="font-mono text-xs">{d.earnings.bank.accountNumberMasked ?? "—"}</span></Row>
              <Row label="IFSC"><span className="font-mono text-xs">{d.earnings.bank.ifsc ?? "—"}</span></Row>
              <Row label="UPI"><span className="font-mono text-xs">{d.earnings.bank.upiId ?? "—"}</span></Row>
            </div>
            <Link href="/finance/payouts" className="mt-3 block rounded-lg bg-[var(--color-biz-elevated)] px-3 py-2 text-center text-xs font-semibold text-[var(--color-biz-accent)] transition hover:brightness-110">
              Manage payouts →
            </Link>
          </section>

          {/* Support & communication — this partner's tickets */}
          <section className="biz-card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold">
              <Headphones className="h-4 w-4 text-[var(--color-biz-accent)]" /> Support & communication
              {ticketsData?.total ? <span className="rounded-full bg-[var(--color-biz-elevated)] px-2 py-0.5 text-[11px] font-bold">{ticketsData.total}</span> : null}
            </h2>
            {ticketsData?.tickets?.length ? (
              <div className="space-y-2">
                {ticketsData.tickets.slice(0, 6).map((t) => (
                  <Link key={t.id} href="/support" className="block rounded-lg bg-[var(--color-biz-elevated)] px-3 py-2 transition hover:brightness-110">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-semibold">{t.subject}</span>
                      <StatusBadge status={t.status} />
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--color-biz-muted)]">
                      {t.ticketNumber} · {t.source === "partner" ? "raised by partner" : "about this partner"}
                      {t.slaBreached ? " · SLA breached" : ""}
                    </p>
                  </Link>
                ))}
                <Link href="/support" className="block pt-1 text-center text-xs font-semibold text-[var(--color-biz-accent)]">Open Support Ops →</Link>
              </div>
            ) : (
              <p className="text-xs text-[var(--color-biz-muted)]">No support tickets for this partner. Partner ↔ customer contact is via in-app call/SMS; disputes become tickets here.</p>
            )}
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm === "approve" ? "Approve this partner?" : "Revoke approval?"}
        description={confirm === "approve"
          ? `${d.profile.name} will be approved and can sign in to the partner app.`
          : `${d.profile.name} will be rejected and cannot sign in as a partner.`}
        confirmLabel={confirm === "approve" ? "Approve partner" : "Revoke"}
        destructive={confirm === "reject"}
        reasonLabel="Notes (optional)"
        reasonRequired={false}
        isLoading={verifyMut.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={async (notes) => {
          if (!confirm) return;
          setMutErr(null);
          try {
            await verifyMut.mutateAsync({ providerId: d.id, action: confirm, notes });
            await qc.invalidateQueries({ queryKey: ["admin", "provider-detail", id] });
            setConfirm(null);
          } catch (e) {
            setMutErr(getErrorMessage(e));
          }
        }}
      />
    </div>
  );
}

/* ── local UI bits ── */

function StatTile({ icon: Icon, label, value, sub, accent }: { icon: typeof Wallet; label: string; value: string; sub?: string; accent?: "green" | "amber" | "red" }) {
  const c = accent === "green" ? "text-emerald-400" : accent === "amber" ? "text-amber-400" : accent === "red" ? "text-red-400" : "text-[var(--color-biz-accent)]";
  return (
    <div className="biz-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">{label}</p>
        <Icon className={`h-4 w-4 ${c}`} />
      </div>
      <p className={`mt-2 text-2xl font-bold ${accent ? c : ""}`}>{value}</p>
      {sub ? <p className="mt-1 text-[11px] text-[var(--color-biz-muted)]">{sub}</p> : null}
    </div>
  );
}

function Meter({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const good = invert ? v <= 20 : v >= 80;
  const mid = invert ? v <= 40 : v >= 50;
  const color = good ? "#10b981" : mid ? "#f59e0b" : "#ef4444";
  return (
    <div className="rounded-xl bg-[var(--color-biz-elevated)] p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">{label}</p>
        <p className="text-sm font-bold" style={{ color }}>{Math.round(v)}%</p>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/30">
        <div className="h-full rounded-full transition-all" style={{ width: `${v}%`, background: color }} />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--color-biz-muted)]">{label}</span>
      {children}
    </div>
  );
}

function DispatchBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const map: Record<string, { t: string; c: string }> = {
    ACCEPTED: { t: "Accepted", c: "bg-emerald-500/15 text-emerald-400" },
    REJECTED: { t: "Rejected", c: "bg-red-500/15 text-red-400" },
    TIMEOUT: { t: "Timed out", c: "bg-amber-500/15 text-amber-400" },
    EXPIRED: { t: "Expired", c: "bg-amber-500/15 text-amber-400" },
    SENT: { t: "Sent", c: "bg-slate-500/15 text-[var(--color-biz-muted)]" },
  };
  const m = map[s] ?? { t: status, c: "bg-slate-500/15 text-[var(--color-biz-muted)]" };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.c}`}>{m.t}</span>;
}
