"use client";

import { memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { EmptyState } from "./EmptyState";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";

const VIRTUALIZE_THRESHOLD = 8;
const ROW_HEIGHT_PX = 52;

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
  emptyDescription?: string;
  onRetry?: () => void;
  title?: string;
  hint?: string;
  icon?: LucideIcon;
  iconTone?: Icon3DTone;
  toolbar?: React.ReactNode;
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
        <td
          key={j}
          className={cn(
            "px-4 py-3.5 align-middle text-sm tabular-nums",
            j === 0 && "font-medium text-[var(--color-biz-text)]",
          )}
        >
          {cell}
        </td>
      ))}
      {row.length < colCount
        ? Array.from({ length: colCount - row.length }).map((_, j) => (
            <td key={`pad-${j}`} className="px-4 py-3.5" />
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
        <div
          key={j}
          className={cn("px-4 py-3.5 text-sm", j === 0 && "font-medium text-[var(--color-biz-text)]")}
        >
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
  emptyDescription,
  onRetry,
  title,
  hint,
  icon: Icon,
  iconTone = "default",
  toolbar,
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
      {title || toolbar || Icon ? (
        <div className="biz-panel-head">
          <div className="flex min-w-0 items-start gap-3">
            {Icon ? <Icon3D icon={Icon} size="sm" tone={iconTone} /> : null}
            <div className="min-w-0">
              {title ? (
                <div className="biz-display text-sm font-semibold tracking-tight">{title}</div>
              ) : null}
              {hint ? <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-biz-muted)]">{hint}</p> : null}
            </div>
          </div>
          {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
        </div>
      ) : null}
      <div
        className="relative overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label={title ? `${title} table` : "Data table"}
      >
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
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-[var(--color-biz-line)] last:border-0">
                    {headers.map((_h, j) => (
                      <td key={j} className="px-4 py-3.5">
                        <span className="biz-skeleton block h-3 w-full max-w-[140px] rounded" />
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            ) : null}
            {isError ? (
              <tr>
                <td colSpan={headers.length} className="px-4 py-10">
                  <EmptyState
                    icon={AlertTriangle}
                    title={errorMessage}
                    description="Check your connection or permissions, then try again."
                    action={
                      onRetry ? (
                        <button type="button" onClick={onRetry} className="biz-btn text-xs">
                          Retry
                        </button>
                      ) : null
                    }
                  />
                </td>
              </tr>
            ) : null}
            {showEmpty ? (
              <tr>
                <td colSpan={headers.length} className="px-4">
                  <EmptyState icon={Inbox} title={emptyMessage} description={emptyDescription} />
                </td>
              </tr>
            ) : null}
            {!virtualize && showRows
              ? rows.map((row, i) => <TableRow key={i} row={row} colCount={headers.length} />)
              : null}
            {virtualize ? (
              <tr>
                <td colSpan={headers.length} className="p-0">
                  <div
                    ref={parentRef}
                    className="max-h-[min(70vh,640px)] overflow-y-auto"
                    tabIndex={0}
                    role="region"
                    aria-label={title ? `${title} rows` : "Table rows"}
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

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  active: "success",
  verified: "success",
  approved: "success",
  online: "success",
  available: "success",
  completed: "success",
  success: "success",
  paid: "success",
  launched: "success",
  training_ready: "success",
  validated: "success",
  new: "success",
  enabled: "success",
  issued: "success",
  redeemed: "success",
  offline: "neutral",
  disabled: "neutral",
  off: "neutral",
  expired: "neutral",
  not_started: "neutral",
  draft: "neutral",
  limited: "warning",
  reviewing: "warning",
  pending: "warning",
  raw: "warning",
  review: "warning",
  in_progress: "warning",
  in_review: "warning",
  requested: "info",
  accepted: "info",
  en_route: "info",
  processing: "info",
  coming_soon: "info",
  planned: "info",
  declined: "danger",
  cancelled: "danger",
  rejected: "danger",
  cancelled_by_user: "danger",
  cancelled_by_provider: "danger",
  banned: "danger",
  high: "danger",
  failed: "danger",
  refunded: "danger",
  medium: "warning",
  low: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase().replace(/\s+/g, "_");
  const tone = STATUS_TONE[key] ?? "neutral";
  return <span className={cn("biz-status", `biz-status--${tone}`)}>{status.replace(/_/g, " ").toLowerCase()}</span>;
}
