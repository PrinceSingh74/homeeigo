"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BadgeCheck, BadgeX, Search, Star, Wrench } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  useAdminDashboardQuery,
  useAdminProvidersQuery,
  useVerifyProviderMutation,
} from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatNumber, inr } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";
import type { AdminProvider } from "@/types/admin";

const PAGE_SIZE = 20;

export default function VendorsPage() {
  const dashboard = useAdminDashboardQuery();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "verified" | "applications"
  >("applications");

  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
    }),
    [debouncedSearch, page, statusFilter],
  );

  const { data, isLoading, isFetching, isError, refetch } = useAdminProvidersQuery(params);
  const verifyMutation = useVerifyProviderMutation();

  const [confirmTarget, setConfirmTarget] = useState<{
    provider: AdminProvider;
    action: "approve" | "reject";
  } | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const rows = (data?.providers ?? []).map((p) => [
    <span key={`id-${p.id}`} className="font-mono text-[10px] text-[var(--color-biz-muted)]">
      {p.id.slice(0, 8)}
    </span>,
    <div key={`name-${p.id}`}>
      <Link href={`/vendors/${p.id}`} className="text-sm font-medium text-[var(--color-biz-accent)] hover:underline">
        {p.name}
      </Link>
      <p className="text-[11px] text-[var(--color-biz-muted)]">
        {p.email ?? "—"}
        {p.city ? ` · ${p.city}` : ""}
        {p.serviceCategories?.length
          ? ` · ${p.serviceCategories.slice(0, 2).join(", ")}`
          : ""}
      </p>
    </div>,
    <span key={`r-${p.id}`} className="flex items-center gap-1">
      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
      {(p.rating ?? 0).toFixed(2)}
    </span>,
    <span key={`jobs-${p.id}`}>{formatNumber(p.totalBookings)}</span>,
    <span key={`earn-${p.id}`}>{inr(p.totalEarnings, true)}</span>,
    <StatusBadge
      key={`v-${p.id}`}
      status={p.isApproved ? "approved" : "pending"}
    />,
    <StatusBadge
      key={`vk-${p.id}`}
      status={p.isVerified ? "verified" : "pending"}
    />,
    <div key={`act-${p.id}`} className="flex justify-end gap-1.5">
      {!p.isApproved ? (
        <button
          type="button"
          disabled={verifyMutation.isPending}
          onClick={() => setConfirmTarget({ provider: p, action: "approve" })}
          className="flex items-center gap-1 rounded-md border border-[var(--color-biz-line)] px-2 py-1 text-[11px] font-medium text-emerald-400 transition hover:bg-[var(--color-biz-elevated)] disabled:opacity-60"
        >
          <BadgeCheck className="h-3 w-3" /> Approve
        </button>
      ) : (
        <button
          type="button"
          disabled={verifyMutation.isPending}
          onClick={() => setConfirmTarget({ provider: p, action: "reject" })}
          className="flex items-center gap-1 rounded-md border border-[var(--color-biz-line)] px-2 py-1 text-[11px] font-medium text-red-400 transition hover:bg-[var(--color-biz-elevated)] disabled:opacity-60"
        >
          <BadgeX className="h-3 w-3" /> Revoke
        </button>
      )}
    </div>,
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Vendors</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Review self-registration applications and manage live partners
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total providers"
          value={dashboard.isLoading ? "—" : formatNumber(dashboard.data?.stats.totalProviders ?? 0)}
          icon={Wrench}
        />
        <KpiCard
          label="Online now"
          value={dashboard.isLoading ? "—" : formatNumber(dashboard.data?.stats.activeNow ?? 0)}
          icon={Wrench}
          accent="green"
        />
        <KpiCard
          label="Matching filter"
          value={formatNumber(data?.total ?? 0)}
          icon={Wrench}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-biz-muted)]" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Search by name…"
            className="w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-biz-accent)]"
          />
        </div>
        <div className="flex gap-1.5">
          {(["applications", "pending", "verified", "all"] as const).map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => {
                setPage(1);
                setStatusFilter(s);
              }}
              className={`rounded-md px-3 py-2 text-xs font-medium capitalize transition ${
                statusFilter === s
                  ? "bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-accent)]"
                  : "border border-[var(--color-biz-line)] hover:bg-[var(--color-biz-elevated)]"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {mutationError ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {mutationError}
        </div>
      ) : null}

      <DataTable
        headers={["ID", "Vendor", "Rating", "Jobs", "Earnings", "Approval", "KYC", ""]}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        onRetry={() => void refetch()}
        emptyMessage="No vendors match the current filters."
        rows={rows}
        footer={
          <Pagination
            page={data?.page ?? page}
            total={data?.total ?? 0}
            limit={PAGE_SIZE}
            onPageChange={setPage}
            isFetching={isFetching}
          />
        }
      />

      <ConfirmDialog
        open={!!confirmTarget}
        title={
          confirmTarget?.action === "approve"
            ? "Approve this vendor?"
            : "Revoke approval?"
        }
        description={
          confirmTarget
            ? confirmTarget.action === "approve"
              ? `${confirmTarget.provider.name} will be approved and can sign in to the partner dashboard.`
              : `${confirmTarget.provider.name} will be rejected and cannot sign in as a partner.`
            : undefined
        }
        confirmLabel={confirmTarget?.action === "approve" ? "Approve vendor" : "Revoke"}
        destructive={confirmTarget?.action === "reject"}
        reasonLabel="Notes (optional)"
        reasonRequired={false}
        reasonPlaceholder={
          confirmTarget?.action === "approve"
            ? "e.g. KYC verified, training complete"
            : "e.g. Failed compliance review"
        }
        isLoading={verifyMutation.isPending}
        onClose={() => setConfirmTarget(null)}
        onConfirm={async (notes) => {
          if (!confirmTarget) return;
          setMutationError(null);
          try {
            await verifyMutation.mutateAsync({
              providerId: confirmTarget.provider.id,
              action: confirmTarget.action,
              notes,
            });
            setConfirmTarget(null);
          } catch (error) {
            setMutationError(getErrorMessage(error));
          }
        }}
      />
    </div>
  );
}
