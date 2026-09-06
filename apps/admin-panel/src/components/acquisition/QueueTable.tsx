"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";

export function QueueFilterBar({
  filters,
  active,
  onChange,
}: {
  filters: Array<{ key: string; label: string }>;
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {filters.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={() => onChange(f.key)}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-semibold",
            active === f.key
              ? "bg-[var(--color-biz-accent)] text-black"
              : "bg-[var(--color-biz-elevated)] text-[var(--color-biz-muted)] ring-1 ring-[var(--color-biz-line)]",
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

export function QueueTable({
  columns,
  rows,
  empty,
}: {
  columns: string[];
  rows: Array<{ id: string; href: string; cells: Array<string | number> }>;
  empty: string;
}) {
  if (!rows.length) {
    return <p className="px-4 py-10 text-center text-sm text-[var(--color-biz-muted)]">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-[var(--color-biz-elevated)] text-left text-xs uppercase tracking-wide text-[var(--color-biz-muted)]">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-4 py-3">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-[var(--color-biz-line)]">
              {row.cells.map((cell, i) => (
                <td key={`${row.id}-${i}`} className="px-4 py-3">
                  {i === 0 ? (
                    <Link href={row.href} className="font-semibold text-[var(--color-biz-accent)]">
                      {cell}
                    </Link>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
