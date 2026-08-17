"use client";

import { memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

const VIRTUALIZE_THRESHOLD = 8;
const ROW_HEIGHT_PX = 48;

type DataTableProps = {
  headers?: string[];
  columns?: string[];
  rows: (string | React.ReactNode)[][];
  isLoading?: boolean;
  loading?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  errorMessage?: string;
  emptyMessage?: string;
  onRetry?: () => void;
  title?: string;
  footer?: React.ReactNode;
  flush?: boolean;
};

const TableRow = memo(function TableRow({
  row,
  colCount,
}: {
  row: (string | React.ReactNode)[];
  colCount: number;
}) {
  return (
    <tr className="border-b border-[var(--color-biz-line)] transition-colors last:border-0 hover:bg-[var(--color-biz-elevated)]/60">
      {row.map((cell, j) => (
        <td key={j} className="px-4 py-3 tabular-nums">
          {cell}
        </td>
      ))}
      {row.length < colCount
        ? Array.from({ length: colCount - row.length }).map((_, j) => (
            <td key={`pad-${j}`} className="px-4 py-3" />
          ))
        : null}
    </tr>
  );
});

const VirtualRow = memo(function VirtualRow({
  row,
  colCount,
  style,
  measureRef,
}: {
  row: (string | React.ReactNode)[];
  colCount: number;
  style: React.CSSProperties;
  measureRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={measureRef}
      className="absolute left-0 top-0 grid w-full border-b border-[var(--color-biz-line)] transition-colors hover:bg-[var(--color-biz-elevated)]/60"
      style={{
        ...style,
        gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
      }}
    >
      {row.map((cell, j) => (
        <div key={j} className="px-4 py-3">
          {cell}
        </div>
      ))}
    </div>
  );
});

function DataTableInner({
  headers: headersProp,
  columns,
  rows,
  isLoading: isLoadingProp,
  loading,
  isFetching = false,
  isError = false,
  errorMessage = "Failed to load data.",
  emptyMessage = "No records found.",
  onRetry,
  title,
  footer,
  flush = false,
}: DataTableProps) {
  useRenderProbe("DataTable");
  useMountProbe("DataTable");
  const headers = headersProp ?? columns ?? [];
  const isLoading = isLoadingProp ?? loading ?? false;
  const showEmpty = !isLoading && !isError && rows.length === 0;
  const showRows = !isLoading && !isError && rows.length > 0;
  const virtualize = showRows && rows.length >= VIRTUALIZE_THRESHOLD;
  const parentRef = useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 4,
  });

  const virtualRows = virtualize ? virtualizer.getVirtualItems() : [];

  return (
    <div className={flush ? "overflow-hidden" : "biz-card overflow-hidden"}>
      {title ? (
        <div className="biz-display border-b border-[var(--color-biz-line)] bg-[var(--color-biz-glass)] px-4 py-3 text-sm font-semibold tracking-tight">
          {title}
        </div>
      ) : null}
      <div className="relative overflow-x-auto">
        {isFetching && !isLoading ? (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md bg-[var(--color-biz-bg)]/80 px-2 py-1 text-[10px] text-[var(--color-biz-muted)] backdrop-blur">
            <Loader2 className="h-3 w-3 animate-spin" />
            Updating…
          </div>
        ) : null}
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="biz-thead-sticky">
            <tr className="border-b border-[var(--color-biz-line)]">
              {headers.map((h) => (
                <th key={h} className="biz-th px-4 py-2.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <>
                {Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-[var(--color-biz-line)] last:border-0">
                    {headers.map((_h, j) => (
                      <td key={j} className="px-4 py-3.5">
                        <span className="block h-3 w-full max-w-[140px] rounded bg-[var(--color-biz-elevated)]" />
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            ) : null}
            {isError ? (
              <tr>
                <td colSpan={headers.length} className="px-4 py-10">
                  <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
                    <AlertTriangle className="h-6 w-6 text-red-400" />
                    <p className="text-sm text-[var(--color-biz-text)]">{errorMessage}</p>
                    {onRetry ? (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="rounded-md border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-biz-elevated)]"
                      >
                        Retry
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : null}
            {showEmpty ? (
              <tr>
                <td
                  colSpan={headers.length}
                  className="px-4 py-10 text-center text-sm text-[var(--color-biz-muted)]"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : null}
            {!virtualize && showRows
              ? rows.map((row, i) => (
                  <TableRow key={i} row={row} colCount={headers.length} />
                ))
              : null}
            {virtualize ? (
              <tr>
                <td colSpan={headers.length} className="p-0">
                  <div
                    ref={parentRef}
                    className="max-h-[min(70vh,640px)] overflow-y-auto"
                  >
                    <div
                      className="relative w-full"
                      style={{ height: `${virtualizer.getTotalSize()}px` }}
                    >
                      {virtualRows.map((vRow) => {
                        const row = rows[vRow.index]!;
                        return (
                          <VirtualRow
                            key={vRow.key}
                            row={row}
                            colCount={headers.length}
                            measureRef={virtualizer.measureElement}
                            style={{ transform: `translateY(${vRow.start}px)` }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  );
}

function rowsSignature(rows: (string | React.ReactNode)[][]): string {
  if (rows.length === 0) return "0";
  return `${rows.length}:${rows[0]?.length ?? 0}`;
}

export const DataTable = memo(DataTableInner, (prev, next) => {
  return (
    prev.isLoading === next.isLoading &&
    prev.isFetching === next.isFetching &&
    prev.isError === next.isError &&
    prev.flush === next.flush &&
    prev.emptyMessage === next.emptyMessage &&
    prev.errorMessage === next.errorMessage &&
    rowsSignature(prev.rows) === rowsSignature(next.rows) &&
    (prev.headers ?? prev.columns)?.join("|") === (next.headers ?? next.columns)?.join("|")
  );
});

export function StatusBadge({
  status,
}: {
  status: string;
}) {
  const styles: Record<string, string> = {
    active: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    verified: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    approved: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    online: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    offline: "border-zinc-500/25 bg-zinc-500/10 text-zinc-400",
    available: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    limited: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    coming_soon: "border-sky-500/25 bg-sky-500/10 text-sky-400",
    launched: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    planned: "border-blue-500/25 bg-blue-500/10 text-blue-400",
    reviewing: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    declined: "border-red-500/25 bg-red-500/10 text-red-400",
    new: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    completed: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    training_ready: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    validated: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    in_progress: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    accepted: "border-blue-500/25 bg-blue-500/10 text-blue-400",
    en_route: "border-blue-500/25 bg-blue-500/10 text-blue-400",
    requested: "border-blue-500/25 bg-blue-500/10 text-blue-400",
    pending: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    raw: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    review: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    cancelled: "border-red-500/25 bg-red-500/10 text-red-400",
    rejected: "border-red-500/25 bg-red-500/10 text-red-400",
    cancelled_by_user: "border-red-500/25 bg-red-500/10 text-red-400",
    cancelled_by_provider: "border-red-500/25 bg-red-500/10 text-red-400",
    banned: "border-red-500/25 bg-red-500/10 text-red-400",
    not_started: "border-zinc-500/25 bg-zinc-500/10 text-zinc-400",
    in_review: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    high: "border-red-500/25 bg-red-500/10 text-red-400",
    medium: "border-amber-500/25 bg-amber-500/10 text-amber-400",
    low: "border-zinc-500/25 bg-zinc-500/10 text-zinc-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
        styles[status] ?? "border-zinc-500/25 bg-zinc-500/10 text-zinc-400",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />
      {status.replace(/_/g, " ")}
    </span>
  );
}
