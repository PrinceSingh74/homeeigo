/**
 * Route-level suspense fallback — a designed ghost of the typical HQ page
 * (header + KPI row + panel) so navigation feels instant, never blank.
 */
export function RouteLoadingSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="mx-auto max-w-7xl space-y-6" aria-busy="true" aria-label={label}>
      {/* Page header ghost */}
      <div className="space-y-2 border-b border-[var(--color-biz-line)] pb-4">
        <div className="biz-skeleton h-7 w-56 rounded-lg" />
        <div className="biz-skeleton h-3.5 w-80 max-w-full rounded" />
      </div>

      {/* KPI row ghost */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="biz-glass-panel p-4">
            <div className="biz-skeleton h-3 w-20 rounded" />
            <div className="biz-skeleton mt-3 h-7 w-28 rounded-lg" />
            <div className="biz-skeleton mt-2 h-3 w-24 rounded" />
          </div>
        ))}
      </div>

      {/* Content panel ghost */}
      <div className="biz-card p-4">
        <div className="biz-skeleton h-4 w-40 rounded" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="biz-skeleton h-9 w-full rounded-lg" />
          ))}
        </div>
      </div>

      <p className="sr-only">{label}</p>
    </div>
  );
}
