import { PerformanceCharts } from "@/components/analytics/PerformanceCharts";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Performance</h1>
        <p className="text-sm text-partner-muted">
          Ratings, completion, and weekly trends
        </p>
      </div>
      <PerformanceCharts />
    </div>
  );
}
