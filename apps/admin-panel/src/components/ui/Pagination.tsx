import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

type PaginationProps = {
  page: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  isFetching?: boolean;
  className?: string;
};

export function Pagination({
  page,
  total,
  limit,
  onPageChange,
  isFetching,
  className,
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  const prevDisabled = page <= 1 || isFetching;
  const nextDisabled = page >= pageCount || isFetching;

  return (
    <div className={cn("flex items-center justify-between gap-3 border-t border-[var(--color-biz-line)] px-4 py-3 text-xs text-[var(--color-biz-muted)]", className)}>
      <span>
        Showing <span className="font-medium text-[var(--color-biz-text)]">{from}</span>–
        <span className="font-medium text-[var(--color-biz-text)]">{to}</span> of
        <span className="font-medium text-[var(--color-biz-text)]"> {total}</span>
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={prevDisabled}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className={cn(
            "flex items-center gap-1 rounded-md border border-[var(--color-biz-line)] px-2 py-1 transition",
            prevDisabled
              ? "opacity-40"
              : "hover:bg-[var(--color-biz-elevated)] hover:text-[var(--color-biz-text)]",
          )}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Prev
        </button>
        <span className="px-2 font-medium text-[var(--color-biz-text)]">
          Page {page} / {pageCount}
        </span>
        <button
          type="button"
          disabled={nextDisabled}
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          className={cn(
            "flex items-center gap-1 rounded-md border border-[var(--color-biz-line)] px-2 py-1 transition",
            nextDisabled
              ? "opacity-40"
              : "hover:bg-[var(--color-biz-elevated)] hover:text-[var(--color-biz-text)]",
          )}
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
