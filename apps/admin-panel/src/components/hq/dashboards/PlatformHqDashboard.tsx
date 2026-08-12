"use client";

import { useQuery } from "@tanstack/react-query";
import { Shield, Users, KeyRound, FileText } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { formatNumber } from "@/lib/format";
import { GlassPanel } from "../GlassPanel";
import { StatTile, DataUnavailable, SectionHeading } from "../primitives";

export function PlatformHqDashboard() {
  const platform = useQuery({
    queryKey: ["hq", "platform", "intelligence"],
    queryFn: () => adminApi.platformIntelligence(),
    staleTime: 120_000,
    retry: false,
  });
  const me = useQuery({
    queryKey: ["hq", "platform", "rbac-me"],
    queryFn: () => adminApi.rbac.me(),
    staleTime: 300_000,
    retry: false,
  });
  const roles = useQuery({
    queryKey: ["hq", "platform", "rbac-roles"],
    queryFn: () => adminApi.rbac.roles(),
    staleTime: 300_000,
    retry: false,
  });
  const admins = useQuery({
    queryKey: ["hq", "platform", "rbac-admins"],
    queryFn: () => adminApi.rbac.admins(),
    staleTime: 300_000,
    retry: false,
  });

  const roleList = roles.data?.roles ?? [];
  const adminList = admins.data?.admins ?? [];
  const permissions = me.data?.permissions ?? [];
  const pi = platform.data;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Feature Flags" value={pi ? String(pi.flagCount) : "—"} sub={`${pi?.enabledFlags ?? 0} enabled`} icon={Shield} loading={platform.isLoading} tone="accent" />
        <StatTile label="Kill Switches" value={pi ? String(pi.killSwitches.length) : "—"} icon={Shield} loading={platform.isLoading} tone={pi && pi.killSwitches.length > 0 ? "danger" : "success"} />
        <StatTile label="Experiments" value={pi ? String(pi.experiments.length) : "—"} sub="incl. surge_v1" icon={FileText} loading={platform.isLoading} />
        <StatTile label="Your Role" value={me.data?.role ?? "—"} icon={Shield} loading={me.isLoading} tone="accent" />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Permissions" value={formatNumber(permissions.length)} sub="granted to you" icon={KeyRound} loading={me.isLoading} />
        <StatTile label="Defined Roles" value={formatNumber(roleList.length)} icon={Shield} loading={roles.isLoading} />
        <StatTile label="Admin Users" value={formatNumber(adminList.length)} icon={Users} loading={admins.isLoading} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <SectionHeading title="Feature Flags & Rollouts" hint="live" />
          {platform.isLoading ? (
            <div className="biz-skeleton h-32 w-full rounded" />
          ) : pi && pi.featureFlags.length > 0 ? (
            <div className="space-y-1.5">
              {pi.featureFlags.map((f) => (
                <div key={f.key} className="flex items-center justify-between rounded-lg bg-[var(--color-biz-bg)] px-3 py-2 text-xs">
                  <span className="truncate font-mono">{f.key}</span>
                  <span className={f.enabled ? "text-[var(--color-biz-success)]" : "text-[var(--color-biz-muted)]"}>
                    {f.enabled ? `ON ${f.rolloutPct}%` : "OFF"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <DataUnavailable title="No flags configured" reason="PATCH /api/admin/platform/flags to register flags and rollouts." />
          )}
        </GlassPanel>

        <GlassPanel className="p-5">
          <SectionHeading title="Experiments & A/B" hint="live" />
          {platform.isLoading ? (
            <div className="biz-skeleton h-32 w-full rounded" />
          ) : pi && pi.experiments.length > 0 ? (
            <div className="space-y-1.5">
              {pi.experiments.map((e) => (
                <div key={e.key} className="flex items-center justify-between rounded-lg bg-[var(--color-biz-bg)] px-3 py-2 text-xs">
                  <span className="truncate">{e.key}</span>
                  <span className="capitalize text-[var(--color-biz-accent)]">{e.status}</span>
                </div>
              ))}
            </div>
          ) : (
            <DataUnavailable title="No experiments" reason="Register experiments in platform_experiments or use pricing surge_v1." />
          )}
        </GlassPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <SectionHeading title="Roles" hint="RBAC" />
          {roles.isLoading ? (
            <div className="biz-skeleton h-32 w-full rounded" />
          ) : roles.isError ? (
            <DataUnavailable title="RBAC unavailable" reason="Role registry could not be loaded (insufficient permission or endpoint disabled)." />
          ) : roleList.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {roleList.map((r, i) => (
                <span key={i} className="rounded-md border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-2.5 py-1 text-xs">
                  {String((r as Record<string, unknown>).name ?? (r as Record<string, unknown>).role ?? `role ${i + 1}`)}
                </span>
              ))}
            </div>
          ) : (
            <DataUnavailable title="No roles" reason="No roles defined." />
          )}
        </GlassPanel>

        <GlassPanel className="p-5">
          <SectionHeading title="Your Permissions" hint="current session" />
          {me.isLoading ? (
            <div className="biz-skeleton h-32 w-full rounded" />
          ) : permissions.length > 0 ? (
            <div className="max-h-48 flex-wrap gap-1.5 overflow-y-auto">
              <div className="flex flex-wrap gap-1.5">
                {permissions.map((p, i) => (
                  <span key={i} className="rounded-md bg-[var(--color-biz-accent-dim)] px-2 py-0.5 text-[11px] text-[var(--color-biz-accent)]">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <DataUnavailable title="No explicit permissions" reason="Current admin has no scoped permission list (likely super-admin or RBAC not enforced)." />
          )}
        </GlassPanel>
      </div>

      <GlassPanel className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <FileText className="h-4 w-4 text-[var(--color-biz-accent)]" />
          <h2 className="text-sm font-semibold">Reports & Exports</h2>
        </div>
        <p className="text-xs text-[var(--color-biz-muted)]">
          Executive finance reports, ledger audit exports, membership analytics, invoices, and observability
          logs all support CSV/XLSX/PDF export from their respective HQ pages using existing backend endpoints.
        </p>
      </GlassPanel>

    </div>
  );
}
