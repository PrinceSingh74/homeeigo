"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Banknote, Gift, RotateCcw, Wallet } from "lucide-react";
import { GrowthPage } from "@/components/growth/GrowthPage";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { SearchField } from "@/components/ui/SearchField";
import { useAdminGiftCardsQuery } from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDate, formatNumber, inr } from "@/lib/format";

const PAGE_SIZE = 20;

export default function GiftCardsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 350);
  const { data, isLoading, isFetching, isError, refetch } = useAdminGiftCardsQuery({
    page,
    limit: PAGE_SIZE,
    search: debounced || undefined,
  });

  const redeemPct =
    (data?.stats.issued ?? 0) > 0 ? ((data?.stats.redeemed ?? 0) / (data?.stats.issued ?? 1)) * 100 : 0;

  const rows = useMemo(
    () =>
      (data?.cards ?? []).map((c) => [
        <span key="c" className="font-mono text-xs tracking-wide">
          {c.code}
        </span>,
        <span key="a" className="biz-num">
          {inr(c.amount)}
        </span>,
        <span key="b" className="biz-num font-semibold">
          {inr(c.balance)}
        </span>,
        c.recipient,
        <StatusBadge key="s" status={c.status.toLowerCase()} />,
        formatDate(c.createdAt),
      ]),
    [data],
  );

  return (
    <GrowthPage
      icon={Gift}
      title="Gift Cards"
      subtitle="Issued value, redemptions, refunds, and outstanding liability still sitting on the books."
    >
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
        <KpiCard
          label="Cards issued"
          value={formatNumber(data?.stats.count ?? 0)}
          sub="Lifetime issued"
          icon={Gift}
          loading={isLoading}
        />
        <KpiCard
          label="Value issued"
          value={inr(data?.stats.issued ?? 0)}
          sub="Face value sold"
          icon={Banknote}
          loading={isLoading}
        />
        <KpiCard
          label="Redeemed"
          value={inr(data?.stats.redeemed ?? 0)}
          sub={`${redeemPct.toFixed(0)}% of issued value`}
          icon={Wallet}
          loading={isLoading}
          accent="green"
        />
        <KpiCard
          label="Refunded"
          value={inr(data?.stats.refunded ?? 0)}
          sub="Returned to payer"
          icon={RotateCcw}
          loading={isLoading}
          accent="amber"
        />
        <KpiCard
          label="Outstanding"
          value={inr(data?.stats.outstanding ?? 0)}
          sub="Unredeemed liability"
          icon={AlertTriangle}
          loading={isLoading}
          accent="red"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchField
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search code or recipient…"
          className="w-full max-w-sm"
        />
      </div>

      <DataTable
        title="Issued cards"
        hint="Code, remaining balance, and recipient"
        icon={Gift}
        headers={["Code", "Face value", "Balance", "Recipient", "Status", "Issued"]}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        onRetry={() => void refetch()}
        emptyMessage="No gift cards yet"
        emptyDescription="Issued gift cards will show here with remaining balance and recipient."
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
