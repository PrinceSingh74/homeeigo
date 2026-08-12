"use client";

import { useMemo, useState } from "react";
import { Download, FileText, IndianRupee, Search, TrendingDown, Wallet } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { useAdminInvoicesQuery, useAdminRevenueReportQuery } from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useAdminStore } from "@/stores/admin-store";
import { inr } from "@/lib/format";
import { resolveApiBase } from "@/lib/api-base";

const PAGE_SIZE = 20;

export default function InvoicesPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const debounced = useDebouncedValue(search, 350);
  const [exporting, setExporting] = useState(false);

  const { data: report } = useAdminRevenueReportQuery();
  const { data, isLoading, isFetching, isError, refetch } = useAdminInvoicesQuery({
    page,
    limit: PAGE_SIZE,
    search: debounced || undefined,
  });

  const rows = useMemo(
    () =>
      (data?.invoices ?? []).map((iv) => [
        <span key="n" className="font-mono text-xs">{iv.invoiceNumber}</span>,
        iv.customer,
        iv.service,
        inr(iv.amount),
        iv.refunded > 0 ? <span key="r" className="text-red-400">{inr(iv.refunded)}</span> : "—",
        <StatusBadge key="s" status={iv.status} />,
        new Date(iv.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
      ]),
    [data],
  );

  const exportCsv = async () => {
    setExporting(true);
    try {
      const base = resolveApiBase();
      const token = useAdminStore.getState().accessToken;
      const url = `${base.replace(/\/$/, "")}/api/admin/invoices/export.csv${debounced ? `?search=${encodeURIComponent(debounced)}` : ""}`;
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `homigo-invoices-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(href);
    } finally {
      setExporting(false);
    }
  };

  return (
    <PageShell title="Invoices & Revenue" subtitle="Unified billing across bookings, subscriptions & gift cards">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Gross revenue" value={inr(report?.grossRevenue ?? 0)} icon={IndianRupee} />
        <KpiCard label="Refunds" value={inr(report?.refunds ?? 0)} icon={TrendingDown} />
        <KpiCard label="Net revenue" value={inr(report?.netRevenue ?? 0)} icon={Wallet} />
        <KpiCard
          label="Streams"
          value={inr((report?.streams.bookings ?? 0))}
          icon={FileText}
          sub={`Subs ${inr(report?.streams.subscriptions ?? 0)} · Gifts ${inr(report?.streams.giftCards ?? 0)}`}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-biz-muted)]" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search invoice or customer…"
            className="w-72 rounded-lg border border-[var(--color-biz-line)] bg-transparent py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-biz-primary)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Download size={15} /> {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      <div className="mt-3">
        <DataTable
          headers={["Invoice", "Customer", "Service", "Amount", "Refunded", "Status", "Date"]}
          isLoading={isLoading}
          isFetching={isFetching}
          isError={isError}
          onRetry={() => void refetch()}
          emptyMessage="No invoices found."
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
