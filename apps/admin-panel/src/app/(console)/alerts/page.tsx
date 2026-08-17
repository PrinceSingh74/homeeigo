"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  Clock,
  ExternalLink,
  Loader2,
  Radio,
  RefreshCw,
  ShieldAlert,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D } from "@/components/hq/Icon3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { adminApi, type OpsMapData, type ProviderDetail } from "@/services/admin-api";
import { useAdminStore } from "@/stores/admin-store";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { resolveWsBase } from "@/lib/api-base";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

const SEVERITY = {
  critical: { rank: 3, label: "Critical", tone: "danger" as const, pill: "is-hot" },
  warning: { rank: 2, label: "Warning", tone: "warning" as const, pill: "is-warm" },
  info: { rank: 1, label: "Info", tone: "cyan" as const, pill: "is-good" },
} as const;
type Severity = keyof typeof SEVERITY;
const ACK_KEY = "homigo_acked_alerts";
type AlertLike = { type: string; bookingId?: string; providerId?: string };
type Alert = {
  type: string;
  severity: Severity;
  bookingId?: string;
  providerId?: string;
  message: string;
  pushedAt?: number;
};

const PLAYBOOK: Record<
  string,
  { label: string; icon: LucideIcon; meaning: string; impact: string; action: string }
> = {
  PROVIDER_OFFLINE: {
    label: "Provider offline",
    icon: WifiOff,
    meaning: "This job has an assigned partner, but their presence dropped offline. They cannot receive live dispatch pings until they come back.",
    impact: "Customer wait time grows. Job may stall in ACCEPTED / ASSIGNED / EN_ROUTE without a live partner.",
    action: "Open the booking, confirm partner last-seen, then reassign or force dispatch if they stay offline.",
  },
  BOOKING_DELAYED: {
    label: "Booking delayed",
    icon: Clock,
    meaning: "Scheduled start time has already passed and the job is still waiting to begin (ACCEPTED or ASSIGNED).",
    impact: "SLA clock is running. Customer is likely waiting at home with no on-site start.",
    action: "Check the schedule and partner status. Reschedule with the customer or dispatch a nearby partner.",
  },
  ETA_BREACH: {
    label: "ETA breach",
    icon: AlertTriangle,
    meaning: "Travel ETA on this live job is above the 60-minute ops threshold.",
    impact: "Arrival is late. Risk of cancellation, poor rating, and knock-on delays for the next job.",
    action: "Review route / traffic, notify the customer, and reassign if a closer partner is available.",
  },
};

function alertKey(a: AlertLike) {
  return `${a.type}:${a.bookingId ?? ""}:${a.providerId ?? ""}`;
}

function loadAcked(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(ACK_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function saveAcked(s: Set<string>) {
  if (typeof window !== "undefined") localStorage.setItem(ACK_KEY, JSON.stringify([...s]));
}

function playbook(type: string) {
  return (
    PLAYBOOK[type] ?? {
      label: type.replace(/_/g, " ").toLowerCase(),
      icon: ShieldAlert,
      meaning: "Operational condition raised by the live ops-map engine.",
      impact: "Needs operator review before the job slips further.",
      action: "Open the linked booking and partner profile, then take the matching ops action.",
    }
  );
}

function timeAgo(ts?: number) {
  if (!ts) return "From snapshot";
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 1) return "Just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

function MetricRow({ label, value, heat }: { label: string; value: string; heat?: "good" | "warn" | "bad" }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-biz-line)] py-2.5 last:border-0">
      <span className="text-sm text-[var(--color-biz-muted)]">{label}</span>
      <span
        data-stat-value
        className={cn(
          "text-sm font-bold tabular-nums",
          heat === "good" && "text-[var(--color-biz-success)]",
          heat === "warn" && "text-[var(--color-biz-warning)]",
          heat === "bad" && "text-[var(--color-biz-danger)]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default function AlertsPage() {
  const token = useAdminStore((s) => s.accessToken);
  const q = useQuery({
    queryKey: ["admin", "alerts"],
    queryFn: () => adminApi.opsMap(),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const [acked, setAcked] = useState<Set<string>>(() => loadAcked());
  const [sev, setSev] = useState<"all" | "critical" | "warning">("all");
  const [type, setType] = useState("all");
  const [toast, setToast] = useState<string | null>(null);
  const [pushed, setPushed] = useState<Map<string, Alert>>(new Map());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const seenCritical = useRef<Set<string>>(new Set());

  const wsUrl = token ? `${resolveWsBase()}/ws/admin-ops?token=${encodeURIComponent(token)}` : null;
  const channel = useRealtimeChannel({
    url: wsUrl,
    enabled: !!wsUrl,
    onMessage: (event) => {
      try {
        const env = JSON.parse(event.data ?? "{}") as { type?: string; data?: Record<string, unknown> };
        if (env.type !== "ADMIN_ALERT" || !env.data) return;
        const d = env.data;
        const a: Alert = {
          type: String(d.type ?? "ALERT"),
          severity: (d.severity as Severity) ?? "warning",
          bookingId: d.bookingId as string | undefined,
          providerId: d.providerId as string | undefined,
          message: String(d.message ?? ""),
          pushedAt: Date.now(),
        };
        setPushed((prev) => {
          const next = new Map(prev);
          next.set(alertKey(a), a);
          return next;
        });
      } catch {
        /* ignore malformed frame */
      }
    },
  });

  const ops = q.data as OpsMapData | undefined;
  const polled = useMemo<Alert[]>(
    () => (ops?.alerts ?? []).map((a) => ({ ...a, severity: (a.severity ?? "warning") as Severity })),
    [ops],
  );

  const alerts = useMemo<Alert[]>(() => {
    const byKey = new Map<string, Alert>();
    for (const a of polled) byKey.set(alertKey(a), a);
    for (const [k, a] of pushed) byKey.set(k, a);
    return [...byKey.values()];
  }, [polled, pushed]);

  useEffect(() => {
    for (const a of alerts) {
      if (a.severity !== "critical") continue;
      const k = alertKey(a);
      if (seenCritical.current.has(k)) continue;
      seenCritical.current.add(k);
      if (!acked.has(k)) {
        setToast(a.message);
        window.setTimeout(() => setToast(null), 4000);
      }
    }
  }, [alerts, acked]);

  const types = useMemo(() => Array.from(new Set(alerts.map((a) => a.type))), [alerts]);
  const filtered = useMemo(
    () =>
      alerts
        .filter((a) => (sev === "all" ? true : a.severity === sev))
        .filter((a) => (type === "all" ? true : a.type === type))
        .sort(
          (a, b) =>
            (b.pushedAt ?? 0) - (a.pushedAt ?? 0) || SEVERITY[b.severity].rank - SEVERITY[a.severity].rank,
        ),
    [alerts, sev, type],
  );

  const unread = filtered.filter((a) => !acked.has(alertKey(a))).length;
  const criticalCount = alerts.filter((a) => a.severity === "critical" && !acked.has(alertKey(a))).length;
  const warningCount = alerts.filter((a) => a.severity === "warning" && !acked.has(alertKey(a))).length;

  const mix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of alerts) {
      if (acked.has(alertKey(a))) continue;
      counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => ({ label: playbook(key).label, value: count }))
      .sort((a, b) => b.value - a.value);
  }, [alerts, acked]);

  const selected = filtered.find((a) => alertKey(a) === selectedKey) ?? filtered[0] ?? null;
  const selectedId = selected ? alertKey(selected) : null;

  useEffect(() => {
    if (selectedId && selectedId !== selectedKey) setSelectedKey(selectedId);
  }, [selectedId, selectedKey]);

  const bookingQ = useQuery({
    queryKey: ["admin", "alert-booking", selected?.bookingId],
    queryFn: () => adminApi.getBookingDetail(selected!.bookingId!),
    enabled: Boolean(selected?.bookingId),
    staleTime: 20_000,
  });
  const providerQ = useQuery({
    queryKey: ["admin", "alert-provider", selected?.providerId],
    queryFn: () => adminApi.getProviderDetail(selected!.providerId!),
    enabled: Boolean(selected?.providerId),
    staleTime: 20_000,
  });

  const booking = ((bookingQ.data as Record<string, unknown> | undefined)?.booking ?? {}) as Record<string, unknown>;
  const provider = providerQ.data as ProviderDetail | undefined;
  const liveBooking = ops?.bookings.find((b) => b.bookingId === selected?.bookingId);
  const liveProvider = ops?.providers.find((p) => p.providerId === selected?.providerId);
  const book = playbook(selected?.type ?? "");

  const ack = (a: AlertLike) => {
    const n = new Set(acked);
    n.add(alertKey(a));
    setAcked(n);
    saveAcked(n);
  };
  const ackAll = () => {
    const n = new Set(acked);
    filtered.forEach((a) => n.add(alertKey(a)));
    setAcked(n);
    saveAcked(n);
  };

  const feedState = channel.connected ? "Live push" : channel.reconnecting ? "Reconnecting" : "Polling";

  return (
    <div className="exec-hq cmd-center mx-auto max-w-[1600px] space-y-8 biz-page-enter">
      {toast ? (
        <div className="fixed right-4 top-4 z-50 rounded-xl border border-[var(--color-biz-danger)]/30 bg-[var(--color-biz-surface)] px-4 py-2.5 text-sm font-semibold text-[var(--color-biz-danger)] shadow-lg">
          {toast}
        </div>
      ) : null}

      <header className="flex flex-col gap-5 border-b border-[var(--color-biz-line)] pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <Icon3D icon={Bell} tone={criticalCount ? "danger" : "warning"} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Alert Center</h1>
              <span className="cmd-live-pill">
                <span className="cmd-live-dot" aria-hidden />
                {feedState}
              </span>
              {unread > 0 ? <span className="ops-alert-pill is-hot">{unread} unread</span> : null}
            </div>
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Live ops conditions — offline partners, delayed starts, ETA breaches · realtime push + 30s backfill
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sev}
            onChange={(e) => setSev(e.target.value as typeof sev)}
            className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] px-3 py-2 text-sm"
          >
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
          </select>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] px-3 py-2 text-sm"
          >
            <option value="all">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {playbook(t).label}
              </option>
            ))}
          </select>
          <button type="button" onClick={ackAll} className="biz-btn">
            <CheckCheck size={14} />
            Mark all read
          </button>
          <button type="button" onClick={() => void q.refetch()} className="biz-btn">
            <RefreshCw size={14} className={q.isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      {q.isLoading ? (
        <div className="flex items-center justify-center py-20 text-[var(--color-biz-muted)]">
          <Loader2 className="mr-2 animate-spin" size={20} />
          Loading alert center…
        </div>
      ) : q.isError ? (
        <div className="biz-glass-panel border-[var(--color-biz-danger)]/30 p-5 text-[var(--color-biz-danger)]">
          Could not load the ops alert feed. Please try again.
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Open alerts"
              value={formatNumber(alerts.length)}
              sub={`${formatNumber(unread)} unread in current filter`}
              icon={Bell}
              tone={unread > 0 ? "danger" : "success"}
            />
            <StatTile
              label="Critical"
              value={formatNumber(criticalCount)}
              sub="Offline partners on live jobs"
              icon={WifiOff}
              tone={criticalCount > 0 ? "danger" : "success"}
            />
            <StatTile
              label="Warnings"
              value={formatNumber(warningCount)}
              sub="Delayed starts and ETA breaches"
              icon={Clock}
              tone={warningCount > 0 ? "accent" : "default"}
            />
            <StatTile
              label="Feed"
              value={channel.connected ? "Live" : channel.reconnecting ? "Retry" : "Poll"}
              sub={channel.connected ? "WebSocket connected" : "30s HTTP backfill"}
              icon={channel.connected ? Wifi : Radio}
              tone={channel.connected ? "success" : "accent"}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
            <div className="biz-glass-panel flex min-h-[28rem] flex-col overflow-hidden p-5">
              <SectionHead
                icon={AlertTriangle}
                tone={criticalCount ? "danger" : "warning"}
                title="Live queue"
                subtitle="Click any alert for full clarification and next action"
                meta={`${filtered.length}`}
              />
              <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                {filtered.length === 0 ? (
                  <p className="rounded-[14px] border border-dashed border-[var(--color-biz-line)] px-4 py-10 text-center text-sm text-[var(--color-biz-muted)]">
                    No alerts match this filter.
                  </p>
                ) : (
                  filtered.map((a) => {
                    const key = alertKey(a);
                    const meta = playbook(a.type);
                    const Icon = meta.icon;
                    const isAcked = acked.has(key);
                    const isOn = key === selectedId;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedKey(key)}
                        className={cn(
                          "ops-alert w-full text-left transition",
                          a.severity === "critical" ? "ops-alert--critical" : "ops-alert--warning",
                          isAcked && "opacity-55",
                          isOn && "ring-2 ring-[var(--color-biz-accent)]/35",
                        )}
                      >
                        <Icon3D icon={Icon} size="sm" tone={SEVERITY[a.severity].tone} />
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em]">{meta.label}</p>
                            <span className={cn("ops-alert-pill", SEVERITY[a.severity].pill)}>{SEVERITY[a.severity].label}</span>
                          </div>
                          <p className="mt-1 truncate text-sm leading-snug">{a.message}</p>
                          <p className="mt-1 text-[11px] text-[var(--color-biz-muted)]">
                            {a.pushedAt ? "Live push" : "Snapshot"} · {timeAgo(a.pushedAt)}
                            {a.bookingId ? ` · #${a.bookingId.slice(-8)}` : ""}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <aside className="biz-glass-panel flex min-h-[28rem] flex-col overflow-hidden p-5">
              {selected ? (
                <>
                  <SectionHead
                    icon={book.icon}
                    tone={SEVERITY[selected.severity].tone}
                    title={book.label}
                    subtitle={SEVERITY[selected.severity].label}
                    meta={selected.pushedAt ? "LIVE" : "SNAP"}
                  />
                  <div className="min-h-0 flex-1 space-y-4 overflow-auto pr-1">
                    <p className="text-sm leading-relaxed">{selected.message}</p>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">What this means</p>
                      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-biz-text)]">{book.meaning}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">Impact</p>
                      <p className="mt-1.5 text-sm leading-relaxed">{book.impact}</p>
                    </div>
                    <div className="rounded-[14px] border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">Recommended action</p>
                      <p className="mt-1.5 text-sm leading-relaxed">{book.action}</p>
                    </div>

                    <MetricRow label="Severity" value={SEVERITY[selected.severity].label} heat={selected.severity === "critical" ? "bad" : "warn"} />
                    <MetricRow label="Source" value={selected.pushedAt ? "Realtime push" : "Ops snapshot"} />
                    <MetricRow label="Seen" value={timeAgo(selected.pushedAt)} />

                    {selected.bookingId ? (
                      <div className="rounded-[14px] border border-[var(--color-biz-line)] p-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">Booking</p>
                        {bookingQ.isLoading ? (
                          <p className="mt-2 text-sm text-[var(--color-biz-muted)]">Loading booking…</p>
                        ) : (
                          <>
                            <p className="mt-2 font-mono text-sm">#{String(booking.bookingNumber ?? selected.bookingId).slice(0, 16)}</p>
                            <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                              {String(booking.status ?? liveBooking?.status ?? "Active")}
                              {booking.scheduledDate ? ` · ${new Date(String(booking.scheduledDate)).toLocaleString("en-IN")}` : ""}
                              {liveBooking?.eta != null ? ` · ETA ${liveBooking.eta}m` : ""}
                            </p>
                            <Link href={`/bookings/${selected.bookingId}`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                              Open booking <ExternalLink size={11} />
                            </Link>
                          </>
                        )}
                      </div>
                    ) : null}

                    {selected.providerId ? (
                      <div className="rounded-[14px] border border-[var(--color-biz-line)] p-4">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">Partner</p>
                        {providerQ.isLoading ? (
                          <p className="mt-2 text-sm text-[var(--color-biz-muted)]">Loading partner…</p>
                        ) : (
                          <>
                            <p className="mt-2 text-sm font-semibold">{provider?.profile.name ?? liveProvider?.name ?? "Assigned partner"}</p>
                            <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                              {provider?.status.isOnline || liveProvider?.status === "ONLINE" ? "Online" : liveProvider?.status ?? "Offline"}
                              {provider?.profile.city ? ` · ${provider.profile.city}` : ""}
                              {provider ? ` · ${provider.metrics.completionRate.toFixed(0)}% complete` : ""}
                            </p>
                            <Link href={`/vendors/${selected.providerId}`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                              Open partner <ExternalLink size={11} />
                            </Link>
                          </>
                        )}
                      </div>
                    ) : null}

                    {!acked.has(alertKey(selected)) ? (
                      <button type="button" onClick={() => ack(selected)} className="biz-btn w-full justify-center">
                        <CheckCheck size={14} />
                        Mark read
                      </button>
                    ) : (
                      <p className="text-center text-xs text-[var(--color-biz-muted)]">Marked as read on this console</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="grid flex-1 place-items-center text-sm text-[var(--color-biz-muted)]">Select an alert to see the full briefing.</p>
              )}
            </aside>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="biz-glass-panel p-6">
              <SectionHead icon={ShieldAlert} tone="warning" title="Unread mix" meta={`${unread} open`} />
              {mix.length ? (
                <IsoBarChart data={mix} format={formatNumber} accent="amber" layout="bar" height={180} />
              ) : (
                <p className="text-sm text-[var(--color-biz-muted)]">Queue is clear — no unread alerts.</p>
              )}
            </div>
            <div className="biz-glass-panel p-6">
              <SectionHead icon={Radio} tone="success" title="Ops context" meta="Live map" />
              <MetricRow label="Located partners" value={formatNumber(ops?.providers.length ?? 0)} />
              <MetricRow label="Active bookings" value={formatNumber(ops?.metrics.activeBookings ?? 0)} />
              <MetricRow label="Service gaps" value={formatNumber(ops?.metrics.serviceGaps ?? 0)} heat={(ops?.metrics.serviceGaps ?? 0) > 0 ? "bad" : "good"} />
              <MetricRow label="Avg ETA" value={`${ops?.metrics.averageEtaMin ?? 0} min`} heat={(ops?.metrics.averageEtaMin ?? 0) >= 45 ? "bad" : "good"} />
              <Link href="/operations" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                Open Live Ops <ExternalLink size={11} />
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
