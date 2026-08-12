"use client";

import { useMemo, useState } from "react";
import { Gift, IndianRupee, TrendingDown, Wallet } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { useAdminGiftCardsQuery } from "@/hooks/use-admin-data";
import { inr, formatNumber } from "@/lib/format";

const PAGE_SIZE = 20;

export default function GiftCardsPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching, isError, refetch } = useAdminGiftCardsQuery({ page, limit: PAGE_SIZE });

  const rows = useMemo(
    () =>
      (data?.cards ?? []).map((c) => [
        <span key="c" className="font-mono text-xs">{c.code}</span>,
        inr(c.amount),
        inr(c.balance),
        c.recipient,
        <StatusBadge key="s" status={c.status.toLowerCase()} />,
        new Date(c.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      ]),
    [data],
  );

  return (
    <PageShell title="Gift Cards" subtitle="Issued cards, redemptions, refunds & outstanding liability">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiCard label="Cards issued" value={formatNumber(data?.stats.count ?? 0)} icon={Gift} />
        <KpiCard label="Value issued" value={inr(data?.stats.issued ?? 0)} icon={IndianRupee} />
        <KpiCard label="Redeemed" value={inr(data?.stats.redeemed ?? 0)} icon={TrendingDown} />
        <KpiCard label="Refunded" value={inr(data?.stats.refunded ?? 0)} icon={Wallet} />
        <KpiCard label="Outstanding" value={inr(data?.stats.outstanding ?? 0)} icon={Wallet} />
      </div>

      <div className="mt-6">
        <DataTable
          headers={["Code", "Face value", "Balance", "Recipient", "Status", "Issued"]}
          isLoading={isLoading}
          isFetching={isFetching}
          isError={isError}
          onRetry={() => void refetch()}
          emptyMessage="No gift cards yet."
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
