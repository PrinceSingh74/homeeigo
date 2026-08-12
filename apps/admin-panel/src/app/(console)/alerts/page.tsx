"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, AlertTriangle, Filter, CheckCheck, Loader2, Wifi, WifiOff } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { useAdminStore } from "@/stores/admin-store";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { resolveApiBase, resolveWsBase } from "@/lib/api-base";

const SEVERITY = {
  critical: { rank: 3, cls: "border-red-500 bg-red-500/10", label: "CRITICAL", accent: "text-red-400" },
  warning: { rank: 2, cls: "border-amber-400 bg-amber-400/10", label: "WARNING", accent: "text-amber-300" },
  info: { rank: 1, cls: "border-sky-400 bg-sky-400/10", label: "INFO", accent: "text-sky-300" },
} as const;
type Severity = keyof typeof SEVERITY;
const ACK_KEY = "homigo_acked_alerts";
type AlertLike = { type: string; bookingId?: string; providerId?: string };
type Alert = { type: string; severity: Severity; bookingId?: string; providerId?: string; message: string; pushedAt?: number };
const alertKey = (a: AlertLike) => `${a.type}:${a.bookingId ?? ""}:${a.providerId ?? ""}`;

function loadAcked(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try { return new Set(JSON.parse(localStorage.getItem(ACK_KEY) ?? "[]")); } catch { return new Set(); }
}
function saveAcked(s: Set<string>) {
  if (typeof window !== "undefined") localStorage.setItem(ACK_KEY, JSON.stringify([...s]));
}

function toWsBase(httpBase: string) {
  return httpBase.replace(/^http/i, "ws").replace(/\/$/, "");
}

/**
 * Admin > Alert Center. Reuses the ops-map alert engine (`/api/admin/ops-map` → ops-map.service)
 * — NO new alert engine. Realtime via the `/ws/admin-ops` channel (server pushes `ADMIN_ALERT`
 * from the leader-locked dispatcher); HTTP poll (30s) is the reconnect/backfill fallback.
 * Severity + type filters, unread counter, client-side acknowledgement, toast on new CRITICAL.
 */
export default function AlertsPage() {
  const token = useAdminStore((s) => s.accessToken);
  const q = useQuery({ queryKey: ["admin", "alerts"], queryFn: () => adminApi.opsMap(), refetchInterval: 30_000 });
  const [acked, setAcked] = useState<Set<string>>(() => loadAcked());
  const [sev, setSev] = useState<"all" | "critical" | "warning">("all");
  const [type, setType] = useState("all");
  const [toast, setToast] = useState<string | null>(null);
  const [pushed, setPushed] = useState<Map<string, Alert>>(new Map());
  const seenCritical = useRef<Set<string>>(new Set());

  // Live alerts pushed over WS (keyed for dedup against the polled snapshot).
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

  const polled = useMemo<Alert[]>(
    () => (q.data?.alerts ?? []).map((a) => ({ ...a, severity: (a.severity ?? "warning") as Severity })),
    [q.data],
  );

  // Merge polled snapshot + WS-pushed alerts, deduped by key (pushed wins — it carries pushedAt).
  const alerts = useMemo<Alert[]>(() => {
    const byKey = new Map<string, Alert>();
    for (const a of polled) byKey.set(alertKey(a), a);
    for (const [k, a] of pushed) byKey.set(k, a);
    return [...byKey.values()];
  }, [polled, pushed]);

  // Toast on a newly-seen unacked CRITICAL (covers both WS push and poll).
  useEffect(() => {
    for (const a of alerts) {
      if (a.severity === "critical") {
        const k = alertKey(a);
        if (!seenCritical.current.has(k)) {
          seenCritical.current.add(k);
          if (!acked.has(k)) { setToast(a.message); setTimeout(() => setToast(null), 4000); }
        }
      }
    }
  }, [alerts, acked]);

  const types = useMemo(() => Array.from(new Set(alerts.map((a) => a.type))), [alerts]);
  const filtered = alerts
    .filter((a) => (sev === "all" ? true : a.severity === sev))
    .filter((a) => (type === "all" ? true : a.type === type))
    .sort((a, b) => (b.pushedAt ?? 0) - (a.pushedAt ?? 0) || SEVERITY[b.severity].rank - SEVERITY[a.severity].rank);
  const unread = filtered.filter((a) => !acked.has(alertKey(a))).length;

  const ack = (a: AlertLike) => { const n = new Set(acked); n.add(alertKey(a)); setAcked(n); saveAcked(n); };
  const ackAll = () => { const n = new Set(acked); filtered.forEach((a) => n.add(alertKey(a))); setAcked(n); saveAcked(n); };

  return (
    <div className="space-y-5 p-1">
      {toast && <div className="fixed right-4 top-4 z-50 rounded-lg border border-red-300 bg-red-600 px-4 py-2 text-sm text-white shadow-lg">🔴 {toast}</div>}

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--color-biz-text)]">
            <Bell size={22} className="text-amber-400" /> Alert Center
            {unread > 0 && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">{unread}</span>}
          </h1>
          <p className="flex items-center gap-1.5 text-sm text-[var(--color-biz-muted)]">
            {channel.connected ? (
              <span className="flex items-center gap-1 text-emerald-400"><Wifi size={13} /> Live</span>
            ) : channel.reconnecting ? (
              <span className="flex items-center gap-1 text-amber-300"><WifiOff size={13} /> Reconnecting…</span>
            ) : (
              <span className="flex items-center gap-1 text-[var(--color-biz-muted)]"><WifiOff size={13} /> Polling</span>
            )}
            · realtime push + 30s backfill
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={sev} onChange={(e) => setSev(e.target.value as typeof sev)} className="rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] px-2.5 py-1.5 text-sm text-[var(--color-biz-text)]">
            <option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option>
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] px-2.5 py-1.5 text-sm text-[var(--color-biz-text)]">
            <option value="all">All types</option>{types.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
          <button onClick={ackAll} className="flex items-center gap-1.5 rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-biz-text)] transition hover:bg-[var(--color-biz-elevated)]"><CheckCheck size={15} /> Mark all read</button>
        </div>
      </header>

      {q.isLoading ? (
        <div className="flex items-center gap-2 p-8 text-[var(--color-biz-muted)]"><Loader2 className="animate-spin" /> Loading alerts…</div>
      ) : filtered.length === 0 ? (
        <div className="biz-card p-8 text-center text-sm text-[var(--color-biz-muted)]">No alerts match the filter. <Filter size={14} className="inline" /></div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((a, i) => {
            const isAcked = acked.has(alertKey(a));
            const s = SEVERITY[a.severity];
            return (
              <li key={alertKey(a) || i} className={`flex items-start justify-between gap-3 rounded-xl border border-[var(--color-biz-line)] border-l-4 bg-[var(--color-biz-surface)] p-3 ${s.cls} ${isAcked ? "opacity-50" : ""}`}>
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${s.accent}`} />
                  <div>
                    <span className={`text-xs font-bold ${s.accent}`}>{s.label}</span> <span className="text-[var(--color-biz-muted)]">·</span> <span className="font-semibold text-[var(--color-biz-text)]">{a.type.replace(/_/g, " ")}</span>
                    {a.pushedAt && <span className="ml-1.5 rounded bg-emerald-500/20 px-1 text-[10px] font-semibold text-emerald-300">LIVE</span>}
                    <p className="text-sm text-[var(--color-biz-text)]">{a.message}</p>
                    {(a.bookingId || a.providerId) && <p className="text-[11px] text-[var(--color-biz-muted)]">{a.bookingId ? `booking #${a.bookingId.slice(-6)}` : ""} {a.providerId ? `· provider #${a.providerId.slice(-6)}` : ""}</p>}
                  </div>
                </div>
                {!isAcked && <button onClick={() => ack(a)} className={`shrink-0 rounded-md border px-2 py-1 text-xs font-medium ${s.accent} border-current transition hover:bg-[var(--color-biz-elevated)]`}>Mark read</button>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
