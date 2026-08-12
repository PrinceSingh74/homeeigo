"use client";

import { useCallback, useEffect, useState } from "react";
import { m as motion, useReducedMotion } from "framer-motion";
import { Laptop, LogOut, MonitorSmartphone, Smartphone } from "lucide-react";
import {
  profilePanelPad,
  profilePanelShell,
} from "@/components/profile/profile-page-layout";
import { Modal } from "@/components/ui/Modal";
import { authApi, type DeviceSession, type SessionsResponse } from "@/services/auth/auth-api";
import { getDeviceId } from "@/lib/auth/device";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

// Lightweight UA parsing — no new dependency. Best-effort browser + OS labels.
function parseUA(ua: string | null): { browser: string; os: string; mobile: boolean } {
  const s = ua ?? "";
  const os = /Windows/i.test(s)
    ? "Windows"
    : /Android/i.test(s)
      ? "Android"
      : /iPhone|iPad|iOS/i.test(s)
        ? "iOS"
        : /Mac OS X|Macintosh/i.test(s)
          ? "macOS"
          : /Linux/i.test(s)
            ? "Linux"
            : "Unknown OS";
  const browser = /Edg\//i.test(s)
    ? "Edge"
    : /OPR\/|Opera/i.test(s)
      ? "Opera"
      : /Chrome\//i.test(s)
        ? "Chrome"
        : /Firefox\//i.test(s)
          ? "Firefox"
          : /Safari\//i.test(s)
            ? "Safari"
            : /Expo|HOMEEIGO|okhttp/i.test(s)
              ? "HOMEEIGO App"
              : "Browser";
  const mobile = /Mobile|Android|iPhone|Expo|HOMEEIGO/i.test(s);
  return { browser, os, mobile };
}

function maskIp(ip: string | null): string {
  if (!ip || ip === "unknown") return "Unknown";
  if (ip.includes(".")) {
    const p = ip.split(".");
    if (p.length === 4) return `${p[0]}.${p[1]}.XX.XX`;
  }
  return ip.length > 6 ? `${ip.slice(0, 6)}…` : ip;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  return d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString("en-IN");
}

function signedIn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Confirm = { kind: "one"; id: string; label: string } | { kind: "others"; count: number } | null;

function SessionCard({
  s,
  onLogout,
}: {
  s: DeviceSession;
  onLogout?: () => void;
}) {
  const { browser, os, mobile } = parseUA(s.userAgent);
  const Icon = mobile ? Smartphone : Laptop;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3.5",
        s.isCurrent ? "border-emerald-500/40 bg-emerald-600/5" : "border-line",
      )}
    >
      <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg bg-[#ECFDF5] text-emerald-600 dark:bg-emerald-600/15">
        <Icon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-display text-[13px] font-bold text-content">
            {s.deviceName || `${browser} on ${os}`}
          </span>
          {s.isCurrent && (
            <span className="rounded-md bg-success/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-success">
              This device
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-muted">{os} · {browser}</p>
        <div className="mt-1.5 space-y-0.5 text-[11px] text-muted">
          <div>IP: {maskIp(s.ipAddress)}</div>
          <div>Last active: {timeAgo(s.lastActivityAt ?? s.createdAt)}</div>
          <div>Signed in: {signedIn(s.createdAt)}</div>
        </div>
      </div>
      {!s.isCurrent && onLogout && (
        <button
          type="button"
          onClick={onLogout}
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-line text-error transition hover:bg-error/5"
          aria-label="Log out this device"
        >
          <LogOut size={16} />
        </button>
      )}
    </div>
  );
}

export function DevicesSessions() {
  const reduce = useReducedMotion();
  const showToast = useAppStore((s) => s.showToast);
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const currentDeviceId = (typeof window !== "undefined" ? getDeviceId() : "") ?? "";

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await authApi.getSessions(currentDeviceId);
      setData(res.data ?? { sessions: [], currentSessionId: null });
    } catch {
      setError(true);
      setData({ sessions: [], currentSessionId: null });
    }
  }, [currentDeviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sessions = data?.sessions ?? [];
  const current = sessions.find((s) => s.isCurrent);
  const others = sessions.filter((s) => !s.isCurrent);

  const runRevoke = async () => {
    if (!confirm || busy) return;
    setBusy(true);
    try {
      if (confirm.kind === "one") {
        await authApi.revokeSession(confirm.id, currentDeviceId);
        showToast("Device signed out", "success");
      } else {
        const n = await authApi.revokeOtherSessions(currentDeviceId);
        showToast(`Signed out ${n.data?.revoked ?? 0} other device(s)`, "success");
      }
      setConfirm(null);
      await load(); // auto refresh from backend
    } catch (e) {
      const msg = e instanceof Error && /403/.test(e.message) ? "Cannot log out your current device" : "Could not complete the action. Please try again.";
      showToast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className={cn(profilePanelShell, "min-w-0", profilePanelPad)}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MonitorSmartphone size={18} className="text-emerald-600" />
          <h2 className="font-display text-base font-bold text-content">Devices &amp; Sessions</h2>
        </div>
        {others.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirm({ kind: "others", count: others.length })}
            className="text-xs font-semibold text-error hover:underline"
          >
            Log out all others
          </button>
        )}
      </div>

      {data === null ? (
        <div className="space-y-2.5">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-canvas dark:bg-charcoal/60" />
          ))}
        </div>
      ) : error ? (
        <div className="py-6 text-center">
          <p className="text-sm text-muted">Could not load your sessions.</p>
          <button type="button" onClick={() => void load()} className="mt-2 text-xs font-semibold text-emerald-600 hover:underline">
            Retry
          </button>
        </div>
      ) : sessions.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No active sessions found.</p>
      ) : (
        <div className="space-y-5">
          {current && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">Current device</p>
              <SessionCard s={current} />
            </div>
          )}

          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">Other devices</p>
            {others.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line py-5 text-center text-xs text-muted">
                This is your only active session.
              </p>
            ) : (
              <div className="space-y-2.5">
                {others.map((s) => (
                  <SessionCard
                    key={s.id}
                    s={s}
                    onLogout={() => {
                      const { browser, os } = parseUA(s.userAgent);
                      setConfirm({ kind: "one", id: s.id, label: s.deviceName || `${browser} on ${os}` });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Modal open={confirm !== null} onClose={() => !busy && setConfirm(null)} title="Confirm sign out" size="sm">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            {confirm?.kind === "one"
              ? `Sign out "${confirm.label}"? That device will need to log in again.`
              : `Sign out of ${confirm?.count ?? 0} other device(s)? Only this device will stay logged in.`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirm(null)}
              disabled={busy}
              className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-content disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void runRevoke()}
              disabled={busy}
              className="flex-1 rounded-xl bg-error px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </Modal>
    </motion.section>
  );
}
