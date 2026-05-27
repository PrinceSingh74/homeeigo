import { ADMIN_KPIS } from "@/lib/admin-data";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const gmv = [1.1, 1.4, 1.2, 1.6, 1.5, 1.3, 1.8];

export default function AnalyticsPage() {
  const max = Math.max(...gmv);
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Revenue, cities, categories, conversion — business intelligence
        </p>
      </div>
      <div className="biz-card p-6">
        <p className="mb-4 text-sm font-semibold">Weekly GMV (₹ Lakhs)</p>
        <div className="flex h-48 items-end justify-between gap-2">
          {gmv.map((v, i) => (
            <div key={days[i]} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full max-w-12 rounded-t bg-[var(--color-biz-accent)]/80"
                style={{ height: `${(v / max) * 100}%`, minHeight: 8 }}
              />
              <span className="text-[10px] text-[var(--color-biz-muted)]">{days[i]}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-sm text-[var(--color-biz-muted)]">
        {ADMIN_KPIS.bookingsToday} bookings today across all cities.
      </p>
    </div>
  );
}
