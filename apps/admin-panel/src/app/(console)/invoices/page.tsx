"use client";

import { useMemo, useState } from "react";
import { Download, FileText, IndianRupee, Search, TrendingDown, Wallet } from "lucide-react";
import { PageShell } from "@/components/ui/PageShell";
import { KpiCard } from "@/components/ui/KpiCard";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { useAdminInvoicesQuery, useAdminRevenueReportQuery } from "@/hooks/use-admin-data";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { apiRequestBlob } from "@/lib/api-client";
import { inr } from "@/lib/format";

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
      // Shared client: bearer + coordinated refresh, and a non-2xx now throws instead of downloading
      // the error body as "invoices.csv".
      const blob = await apiRequestBlob("/api/admin/invoices/export.csv", { auth: true, query: debounced ? { search: debounced } : undefined });
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
    <PageShell
      eyebrow="Finance HQ"
      icon={FileText}
      title="Invoices & Revenue"
      subtitle="Unified billing across bookings, subscriptions, and gift cards. Net is gross minus refunds."
    >
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
        <div className="relative w-72">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-biz-muted)]" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search invoice or customer…"
            className="biz-input pl-9"
          />
        </div>
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={exporting}
          className="biz-btn biz-btn-primary"
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
