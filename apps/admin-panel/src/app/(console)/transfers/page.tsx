"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, IndianRupee } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { useAdminTransfersQuery } from "@/hooks/use-admin-data";
import { inr, formatNumber } from "@/lib/format";

const PAGE_SIZE = 20;

export default function TransfersPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching, isError, refetch } = useAdminTransfersQuery({ page, limit: PAGE_SIZE });

  const rows = useMemo(
    () =>
      (data?.transfers ?? []).map((t) => [
        t.sender,
        t.recipient,
        inr(t.amount),
        <StatusBadge key="s" status={t.status.toLowerCase()} />,
        new Date(t.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      ]),
    [data],
  );

  return (
    <PageShell title="P2P Transfers" subtitle="Wallet-to-wallet transfer audit log">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Completed transfers" value={formatNumber(data?.totals.completedCount ?? 0)} icon={ArrowLeftRight} />
        <KpiCard label="Total volume" value={inr(data?.totals.completedVolume ?? 0)} icon={IndianRupee} />
      </div>

      <div className="mt-6">
        <DataTable
          headers={["Sender", "Recipient", "Amount", "Status", "When"]}
          isLoading={isLoading}
          isFetching={isFetching}
          isError={isError}
          onRetry={() => void refetch()}
          emptyMessage="No transfers yet."
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
      </div>
    </PageShell>
  );
}
