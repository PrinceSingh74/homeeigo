import type { StatsOverview } from "@/services/core/api";

export type LiveMetric = { number: string; label: string };

const nf = (n: number) => n.toLocaleString("en-IN");

/**
 * Marketplace metrics from GET /api/stats/overview — the server's numbers and nothing else.
 *
 * A metric with no real value behind it is left out. There are no defaults: this used to print
 * "11+ cities", "50,000+", "10,000+" and "4.9★" whenever the stats were loading, unavailable or
 * zero, which on a new platform is always.
 */
export function liveMetricsFromStats(stats: StatsOverview | null | undefined): LiveMetric[] {
  if (!stats) return [];
  const out: LiveMetric[] = [];
  if (stats.completedBookings > 0) out.push({ number: nf(stats.completedBookings), label: "Bookings completed" });
  if (stats.activeProviders > 0) out.push({ number: nf(stats.activeProviders), label: "Active professionals" });
  // An average is a rating only when reviews produced it.
  if (stats.averageRating != null && stats.reviewCount > 0) {
    out.push({ number: `${stats.averageRating}★`, label: "Average rating" });
  }
  return out;
}
