"use client";

import { useMemo, useState } from "react";
import { Ban, Search, ShieldCheck, UserPlus, Users } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  useAdminCustomersQuery,
  useAdminDashboardQuery,
  useBanUserMutation,
} from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate, formatNumber, inr } from "@/lib/format";
import { getErrorMessage } from "@/lib/api-error";
import type { AdminCustomer } from "@/types/admin";

const PAGE_SIZE = 20;

export default function CustomersPage() {
  const dashboard = useAdminDashboardQuery();
  const [page, setPage] = useState(1);
  // Seed the search from a ?q= deep-link (global search customer result).
  // Read from location lazily (client-only) so the route stays statically
  // prerendered — useSearchParams would force a Suspense boundary / deopt.
  const [search, setSearch] = useState(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") ?? "" : "",
  );
  const debouncedSearch = useDebouncedValue(search, 300);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "banned">("all");

  const params = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      status: statusFilter === "all" ? undefined : statusFilter,
    }),
    [debouncedSearch, page, statusFilter],
  );

  const { data, isLoading, isFetching, isError, refetch } = useAdminCustomersQuery(params);
  const banMutation = useBanUserMutation();

  const [confirmTarget, setConfirmTarget] = useState<{
    user: AdminCustomer;
    action: "ban" | "unban";
  } | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const rows = (data?.users ?? []).map((u) => [
    <span key={`id-${u.id}`} className="font-mono text-[10px] text-[var(--color-biz-muted)]">
      {u.id.slice(0, 8)}
    </span>,
    <div key={`name-${u.id}`}>
      <p className="text-sm font-medium">
        {u.firstName ?? "—"}
      </p>
      <p className="text-[11px] text-[var(--color-biz-muted)]">{u.email}</p>
    </div>,
    <span key={`bookings-${u.id}`}>{formatNumber(u.totalBookings)}</span>,
    <span key={`spent-${u.id}`}>{inr(u.totalSpent)}</span>,
    <StatusBadge key={`kyc-${u.id}`} status={(u.kycStatus || "pending").toLowerCase()} />,
    <StatusBadge key={`st-${u.id}`} status={u.isActive ? "active" : "banned"} />,
    <span key={`since-${u.id}`} className="text-xs text-[var(--color-biz-muted)]">
      {formatDate(u.createdAt)}
    </span>,
    <div key={`act-${u.id}`} className="flex justify-end gap-1.5">
      <button
        type="button"
        onClick={() =>
          setConfirmTarget({ user: u, action: u.isActive ? "ban" : "unban" })
        }
        disabled={banMutation.isPending}
        className={`flex items-center gap-1 rounded-md border border-[var(--color-biz-line)] px-2 py-1 text-[11px] font-medium transition hover:bg-[var(--color-biz-elevated)] disabled:opacity-60 ${
          u.isActive ? "text-red-400" : "text-emerald-400"
        }`}
      >
        {u.isActive ? <Ban className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
        {u.isActive ? "Ban" : "Unban"}
      </button>
    </div>,
  ]);

  const totalCustomers = dashboard.data?.stats.totalUsers ?? 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Customers</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          All users on homigo.com — moderation, bookings, refunds
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          label="Total customers"
          value={dashboard.isLoading ? "—" : formatNumber(totalCustomers)}
          icon={Users}
        />
        <KpiCard
          label="Showing this page"
          value={formatNumber(data?.users.length ?? 0)}
          icon={UserPlus}
          accent="green"
        />
        <KpiCard
          label="Total matching"
          value={formatNumber(data?.total ?? 0)}
          icon={Users}
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
            placeholder="Search by name or email…"
            className="w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-biz-accent)]"
          />
        </div>
        <div className="flex gap-1.5">
          {(["all", "active", "banned"] as const).map((s) => (
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
        headers={["ID", "Customer", "Bookings", "Spent", "KYC", "Status", "Joined", ""]}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        emptyMessage="No customers match the current filters."
        onRetry={() => void refetch()}
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
          confirmTarget?.action === "ban" ? "Ban this customer?" : "Unban this customer?"
        }
        description={
          confirmTarget
            ? confirmTarget.action === "ban"
              ? `${confirmTarget.user.firstName ?? confirmTarget.user.email} will lose access immediately and all in-flight bookings will be cancelled.`
              : `${confirmTarget.user.firstName ?? confirmTarget.user.email} will regain access to the platform.`
            : undefined
        }
        confirmLabel={confirmTarget?.action === "ban" ? "Ban customer" : "Unban customer"}
        destructive={confirmTarget?.action === "ban"}
        reasonLabel={confirmTarget?.action === "ban" ? "Reason (visible to ops only)" : undefined}
        reasonPlaceholder="e.g. Repeated chargebacks"
        isLoading={banMutation.isPending}
        onClose={() => setConfirmTarget(null)}
        onConfirm={async (reason) => {
          if (!confirmTarget) return;
          setMutationError(null);
          try {
            await banMutation.mutateAsync({
              userId: confirmTarget.user.id,
              action: confirmTarget.action,
              reason,
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
