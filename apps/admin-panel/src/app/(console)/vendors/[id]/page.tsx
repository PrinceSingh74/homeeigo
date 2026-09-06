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
import { ActivationChecklistPanel } from "@/components/acquisition/ActivationChecklistPanel";
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

  const checklistQuery = useQuery({
    queryKey: ["admin", "activation-checklist", id],
    queryFn: () => adminApi.partnerAcquisition.activationChecklist(id),
    enabled: !!id && !!d && !d.verification.isApproved,
    staleTime: 15_000,
  });

  const scoreQuery = useQuery({
    queryKey: ["admin", "provider-score", id],
    queryFn: () => adminApi.getProviderScore(id),
    enabled: !!id,
    staleTime: 30_000,
  });
  const careerQuery = useQuery({
    queryKey: ["admin", "provider-career", id],
    queryFn: () => adminApi.getProviderCareer(id),
    enabled: !!id,
    staleTime: 30_000,
  });
  const lifecycleQuery = useQuery({
    queryKey: ["admin", "provider-lifecycle", id],
    queryFn: () => adminApi.getProviderLifecycle(id),
    enabled: !!id,
    staleTime: 15_000,
  });
  const [lifecycleAction, setLifecycleAction] = useState<"pause" | "review" | "suspend" | "reactivate" | null>(null);
  const lifecycleMut = useMutation({
    mutationFn: (action: "pause" | "review" | "suspend" | "reactivate") =>
      adminApi.transitionProviderLifecycle(id, action, `Admin ${action}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "provider-lifecycle", id] });
      void qc.invalidateQueries({ queryKey: ["admin", "provider-detail", id] });
      void qc.invalidateQueries({ queryKey: ["admin", "provider-career", id] });
      setLifecycleAction(null);
    },
    onError: (err) => setMutErr(getErrorMessage(err)),
  });

  const activationReady = d?.verification.isApproved || checklistQuery.data?.ready === true;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-start gap-3">
          <Link href="/vendors" className="mt-1 rounded-lg border border-[var(--color-biz-line)] p-2">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Partner</h1>
            <p className="text-sm text-[var(--color-biz-muted)]">Loading profile…</p>
          </div>
        </div>
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
            <>
              <button
                type="button"
                onClick={() => setConfirm("reject")}
                disabled={verifyMut.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-500/10 disabled:opacity-60"
              >
                <BadgeX className="h-4 w-4" /> Reject application
              </button>
              <button
                type="button"
                onClick={() => setConfirm("approve")}
                disabled={verifyMut.isPending || !activationReady}
                title={
                  !activationReady
                    ? `Complete activation checklist first: ${checklistQuery.data?.missingLabels.join(", ") ?? "loading…"}`
                    : undefined
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <BadgeCheck className="h-4 w-4" /> Activate partner
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirm("reject")} disabled={verifyMut.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-500/10 disabled:opacity-60">
              <BadgeX className="h-4 w-4" /> Revoke approval
            </button>
          )}
        </div>
      </div>

      {mutErr ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{mutErr}</div> : null}

      <nav aria-label="Partner command surfaces" className="flex flex-wrap gap-2">
        {[
          { href: `/trust-safety/risk/${d.id}`, label: "Risk" },
          { href: "/availability", label: "Availability" },
          { href: "/bookings", label: "Jobs" },
          { href: "/performance", label: "Performance" },
          { href: "/earnings", label: "Earnings" },
          { href: "/kyc", label: "KYC" },
          { href: "/referrals", label: "Referrals" },
          { href: "/support", label: "Support" },
          { href: `/audit?resourceId=${encodeURIComponent(d.id)}`, label: "Audit" },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-full border border-[var(--color-biz-line)] px-3 py-1 text-[11px] font-semibold text-[var(--color-biz-muted)] transition hover:border-[var(--color-biz-accent)]/40 hover:text-[var(--color-biz-text)]"
          >
            {l.label}
          </Link>
        ))}
      </nav>

      {!d.verification.isApproved ? (
        <ActivationChecklistPanel
          providerId={d.id}
          providerName={d.profile.name}
          isApproved={d.verification.isApproved}
          checklist={checklistQuery.data}
          isLoading={checklistQuery.isLoading}
          onRefresh={() => {
            void checklistQuery.refetch();
            void refetch();
          }}
        />
      ) : null}

      <section className="biz-card p-5">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <Star className="h-4 w-4 text-[var(--color-biz-accent)]" /> Score, career &amp; lifecycle
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">Partner score</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">
              {scoreQuery.isLoading ? "…" : scoreQuery.data?.overallScore == null ? "—" : Math.round(scoreQuery.data.overallScore)}
              <span className="text-base font-medium text-[var(--color-biz-muted)]">/100</span>
            </p>
            <p className="text-xs text-[var(--color-biz-muted)]">{scoreQuery.data?.band?.replace(/_/g, " ") ?? "Loading"}</p>
            <dl className="mt-3 space-y-1 text-xs">
              {scoreQuery.data
                ? Object.entries(scoreQuery.data.components).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="capitalize">{k.replace(/([A-Z])/g, " $1")}</dt>
                      <dd className="tabular-nums">{v.value == null ? "n/a" : Math.round(v.value)}</dd>
                    </div>
                  ))
                : null}
            </dl>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">Career</p>
            <p className="mt-1 text-xl font-bold">{careerQuery.data?.currentLevel ?? d.status.careerLevel ?? "—"}</p>
            <p className="text-xs text-[var(--color-biz-muted)]">
              {careerQuery.data?.nextLevel
                ? `${careerQuery.data.progressPct}% toward ${careerQuery.data.nextLevel}`
                : "Top level or loading"}
            </p>
            <p className="mt-2 text-xs">
              Boost {careerQuery.data?.benefitsActive ? `+${careerQuery.data.careerPriorityBoost}` : "restricted"}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-muted)]">Lifecycle</p>
            <p className="mt-1 text-xl font-bold">{lifecycleQuery.data?.lifecycleState ?? d.status.lifecycleState ?? "—"}</p>
            <p className="text-xs text-[var(--color-biz-muted)]">
              Availability: {d.status.currentStatus ?? "—"} {d.status.isOnline ? "· online" : "· offline"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["pause", "review", "suspend", "reactivate"] as const).map((action) => (
                <button
                  key={action}
                  type="button"
                  className="rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-semibold capitalize disabled:opacity-50"
                  disabled={lifecycleMut.isPending}
                  onClick={() => setLifecycleAction(action)}
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        </div>
        {(lifecycleQuery.data?.history.length ?? 0) > 0 ? (
          <ol className="mt-4 max-h-40 space-y-1 overflow-auto text-xs text-[var(--color-biz-muted)]">
            {lifecycleQuery.data!.history.slice(0, 8).map((h) => (
              <li key={h.id}>
                {h.previousState ?? "—"} → {h.newState} · {h.actorType} · {h.reasonCode} · {relTime(h.createdAt)}
              </li>
            ))}
          </ol>
        ) : null}
      </section>
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
        title={
          confirm === "approve"
            ? "Activate this partner?"
            : d.verification.isApproved
              ? "Revoke approval?"
              : "Reject this application?"
        }
        description={
          confirm === "approve"
            ? activationReady
              ? `${d.profile.name} has passed all activation checks and will be approved to sign in.`
              : `Activation blocked — complete checklist items first: ${checklistQuery.data?.missingLabels.join(", ") ?? "unknown"}`
            : d.verification.isApproved
              ? `${d.profile.name}'s approval will be revoked. They cannot operate as a partner until re-approved.`
              : `${d.profile.name} will be rejected and cannot sign in as a partner. Use Request Changes if they can fix gaps.`
        }
        confirmLabel={
          confirm === "approve"
            ? "Activate partner"
            : d.verification.isApproved
              ? "Revoke"
              : "Reject application"
        }
        destructive={confirm === "reject"}
        reasonLabel={confirm === "reject" && !d.verification.isApproved ? "Rejection reason" : "Notes (optional)"}
        reasonRequired={confirm === "reject" && !d.verification.isApproved}
        reasonPlaceholder={
          confirm === "reject" && !d.verification.isApproved
            ? "e.g. Failed compliance review, duplicate identity"
            : undefined
        }
        isLoading={verifyMut.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={async (notes) => {
          if (!confirm || (confirm === "approve" && !activationReady)) return;
          if (confirm === "reject" && !d.verification.isApproved && !notes?.trim()) {
            setMutErr("Please enter a rejection reason.");
            return;
          }
          setMutErr(null);
          try {
            await verifyMut.mutateAsync({ providerId: d.id, action: confirm, notes });
            await qc.invalidateQueries({ queryKey: ["admin", "provider-detail", id] });
            await qc.invalidateQueries({ queryKey: ["admin", "activation-checklist", id] });
            setConfirm(null);
          } catch (e) {
            setMutErr(getErrorMessage(e));
          }
        }}
      />
      <ConfirmDialog
        open={!!lifecycleAction}
        title={`${lifecycleAction ?? "Lifecycle"} this partner?`}
        description="This changes program lifecycle only. Availability, jobs, wallet, and compliance records stay intact. Suspended partners stop receiving new jobs."
        confirmLabel={lifecycleAction ? lifecycleAction[0]!.toUpperCase() + lifecycleAction.slice(1) : "Confirm"}
        destructive={lifecycleAction === "suspend"}
        isLoading={lifecycleMut.isPending}
        onClose={() => setLifecycleAction(null)}
        onConfirm={() => {
          if (!lifecycleAction) return;
          lifecycleMut.mutate(lifecycleAction);
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
