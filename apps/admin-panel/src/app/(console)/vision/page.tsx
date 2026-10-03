"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertCircle, CheckCircle, Clock, Eye, Trash2, Zap } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { AdminApiError } from "@/lib/api-error";
import { PageShell } from "@/components/ui/PageShell";
import { KpiCard } from "@/components/ui/KpiCard";

/**
 * Vision Intelligence analytics + retention controls.
 *
 * Reads through `adminApi.vision` (authenticated, response-envelope aware). The previous version
 * used a bare `fetch("/api/vision/status")`: it sent no Authorization header, so the backend
 * answered 401 on every load (verified against the running backend), and it read stats straight
 * off the response instead of unwrapping `{ success, data }`, so every figure rendered undefined.
 *
 * Backend RBAC remains authoritative — `/api/vision/status` and `/api/vision/admin/purge` both
 * enforce `role === "ADMIN"` server-side and answer 403 regardless of what this page shows.
 */
export default function VisionAdminPage() {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["admin", "vision", "status"],
    queryFn: () => adminApi.vision.status(),
    refetchInterval: 30_000,
    retry: false,
  });

  const purge = useMutation({
    mutationFn: () => adminApi.vision.purgeExpired(),
    onSuccess: (result) => {
      setNotice(
        result.failed > 0
          ? `Purged ${result.purged} expired image(s); ${result.failed} failed and will retry on the next sweep.`
          : `Purged ${result.purged} expired image(s).`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin", "vision", "status"] });
    },
    onError: (err) => setNotice(err instanceof Error ? err.message : "Purge failed"),
  });

  const forbidden = status.error instanceof AdminApiError && status.error.status === 403;

  if (forbidden) {
    return (
      <PageShell title="Vision Analytics" subtitle="AI vision analysis usage, provider mix, and retention.">
        <div className="biz-glass-panel p-6">
          <p className="text-sm text-[var(--color-biz-muted)]">
            Admin access required. Your account does not have permission to view Vision analytics.
          </p>
        </div>
      </PageShell>
    );
  }

  const d = status.data;
  const successRate = d && d.totalAnalyses > 0 ? Math.round((d.successCount / d.totalAnalyses) * 100) : 0;

  return (
    <PageShell title="Vision Analytics" subtitle="AI vision analysis usage, provider mix, and retention.">
      {status.isError && !forbidden ? (
        <div className="biz-glass-panel p-4">
          <p className="text-sm text-[var(--color-biz-danger,#f87171)]">
            {status.error instanceof Error ? status.error.message : "Failed to load Vision status"}
          </p>
        </div>
      ) : null}

      {notice ? (
        <div className="biz-glass-panel p-4">
          <p className="text-sm text-[var(--color-biz-muted)]">{notice}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total analyses"
          value={d ? String(d.totalAnalyses) : "—"}
          icon={Eye}
          loading={status.isLoading}
        />
        <KpiCard
          label="Recent (24h)"
          value={d ? String(d.recentAnalyses) : "—"}
          icon={Activity}
          accent="green"
          loading={status.isLoading}
        />
        <KpiCard
          label="Success rate"
          value={d ? `${successRate}%` : "—"}
          sub={d ? `${d.successCount} of ${d.totalAnalyses}` : undefined}
          icon={CheckCircle}
          accent={d && d.failureCount > 0 ? "amber" : "green"}
          loading={status.isLoading}
        />
        <KpiCard
          label="Avg latency"
          value={d?.averageLatency != null ? `${Math.round(d.averageLatency)}ms` : "—"}
          icon={Clock}
          loading={status.isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="biz-glass-panel p-5">
          <h2 className="biz-display text-sm font-semibold tracking-tight">Provider usage</h2>
          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
            Observation mode:{" "}
            <span className="font-semibold">{d?.observationMode ?? "—"}</span>
            {d?.observationMode === "FALLBACK"
              ? " — no vision provider credential is configured, so results are deterministic placeholders, not model output."
              : null}
          </p>
          <div className="mt-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="biz-icon-chip biz-icon-chip--warning">
                <Zap className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold">Real provider (Gemini)</div>
                <div className="text-xs text-[var(--color-biz-muted)]">
                  {d ? `${d.geminiCount} analyses` : "—"}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="biz-icon-chip">
                <Activity className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold">Fallback (no model call)</div>
                <div className="text-xs text-[var(--color-biz-muted)]">
                  {d ? `${d.fallbackCount} analyses` : "—"}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="biz-glass-panel p-5">
          <h2 className="biz-display text-sm font-semibold tracking-tight">Status</h2>
          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-emerald-500" />
              <span>{d ? `${d.successCount} successful` : "—"}</span>
            </div>
            {d && d.failureCount > 0 ? (
              <div className="flex items-center gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <span>
                  {d.failureCount} failed — recorded as REAL_PROVIDER with a PROVIDER_ERROR flag, so a
                  provider outage stays distinguishable from &ldquo;no model looked&rdquo;.
                </span>
              </div>
            ) : null}
            {d?.lastAnalysisAt ? (
              <p className="pt-2 text-xs text-[var(--color-biz-muted)]">
                Last analysis: {new Date(d.lastAnalysisAt).toLocaleString()}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="biz-glass-panel p-5">
        <h2 className="biz-display text-sm font-semibold tracking-tight">Retention</h2>
        <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
          Deletes the stored bytes of every image past its retention date. The analysis row is kept and
          marked PURGED — it explains a past decision and holds no photograph.
        </p>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Purge expired vision images? The image bytes cannot be recovered.")) {
              purge.mutate();
            }
          }}
          disabled={purge.isPending}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[var(--color-biz-line)] px-3 py-2 text-sm font-semibold transition hover:bg-[var(--color-biz-elevated)] disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          {purge.isPending ? "Purging…" : "Purge expired images"}
        </button>
      </div>
    </PageShell>
  );
}
