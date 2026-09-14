"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, IndianRupee, List, Wallet } from "lucide-react";
import { GrowthPage } from "@/components/growth/GrowthPage";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { SearchField } from "@/components/ui/SearchField";
import { useAdminTransfersQuery } from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDateTime, formatNumber, inr } from "@/lib/format";

const PAGE_SIZE = 20;

export default function TransfersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 350);
  const { data, isLoading, isFetching, isError, refetch } = useAdminTransfersQuery({
    page,
    limit: PAGE_SIZE,
    search: debounced || undefined,
  });

  const transfers = data?.transfers ?? [];
  const avg =
    (data?.totals.completedCount ?? 0) > 0
      ? (data?.totals.completedVolume ?? 0) / (data?.totals.completedCount ?? 1)
      : 0;

  const rows = useMemo(
    () =>
      transfers.map((t) => [
        t.sender,
        t.recipient,
        <span key="a" className="biz-num font-semibold">
          {inr(t.amount)}
        </span>,
        <StatusBadge key="s" status={t.status.toLowerCase()} />,
        formatDateTime(t.createdAt),
      ]),
    [transfers],
  );

  return (
    <GrowthPage
      icon={ArrowLeftRight}
      title="Transfers"
      subtitle="Wallet-to-wallet movement between customers. This is an audit log — it does not post partner earnings or change job state."
    >
      <div className="biz-kpi-grid">
        <KpiCard
          label="Completed transfers"
          value={formatNumber(data?.totals.completedCount ?? 0)}
          sub="Successfully settled"
          icon={ArrowLeftRight}
          loading={isLoading}
        />
        <KpiCard
          label="Total volume"
          value={inr(data?.totals.completedVolume ?? 0)}
          sub="Completed transfer value"
          icon={IndianRupee}
          loading={isLoading}
        />
        <KpiCard
          label="Average transfer"
          value={inr(avg)}
          sub="Volume ÷ completed count"
          icon={Wallet}
          loading={isLoading}
        />
        <KpiCard
          label="This page"
          value={formatNumber(transfers.length)}
          sub={`${formatNumber(data?.pagination.total ?? 0)} in ledger`}
          icon={List}
          loading={isLoading}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchField
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search sender or recipient…"
          className="w-full max-w-sm"
        />
      </div>

      <DataTable
        title="Transfer ledger"
        hint="Sender, recipient, amount, and settlement status"
        icon={ArrowLeftRight}
        iconTone="cyan"
        headers={["Sender", "Recipient", "Amount", "Status", "When"]}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        onRetry={() => void refetch()}
        emptyMessage="No transfers yet"
        emptyDescription="Wallet-to-wallet transfers will appear here once customers start sending money."
        rows={rows}
        footer={
          <Pagination
            page={data?.pagination.page ?? page}
            total={data?.pagination.total ?? 0}
            limit={PAGE_SIZE}
            onPageChange={setPage}
            isFetching={isFetching}
          />
        }
      />
    </GrowthPage>
  );
}
