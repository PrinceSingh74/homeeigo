import { cn } from "@/lib/cn";

export function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | React.ReactNode)[][];
}) {
  return (
    <div className="biz-card overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--color-biz-line)] text-[var(--color-biz-muted)]">
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-[var(--color-biz-line)] last:border-0 hover:bg-[var(--color-biz-elevated)]/50"
            >
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatusBadge({
  status,
}: {
  status: string;
}) {
  const styles: Record<string, string> = {
    active: "bg-emerald-500/15 text-emerald-400",
    verified: "bg-emerald-500/15 text-emerald-400",
    completed: "bg-emerald-500/15 text-emerald-400",
    in_progress: "bg-amber-500/15 text-amber-400",
    requested: "bg-blue-500/15 text-blue-400",
    pending: "bg-amber-500/15 text-amber-400",
    review: "bg-amber-500/15 text-amber-400",
    cancelled: "bg-red-500/15 text-red-400",
    high: "bg-red-500/15 text-red-400",
    medium: "bg-amber-500/15 text-amber-400",
    low: "bg-zinc-500/15 text-zinc-400",
  };
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        styles[status] ?? "bg-zinc-500/15 text-zinc-400"
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}
