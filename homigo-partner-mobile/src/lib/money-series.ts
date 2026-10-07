/**
 * Shapes the server's series for drawing. Pure: no React Native import.
 *
 * These are proportions for bar heights and widths only. No total, average, trend or "best day" is
 * derived here — every figure a screen prints comes from the server's own fields.
 */

export type SeriesPoint = { date: string; amount: number };

export type ChartBar = { date: string; amount: number; /** 0–1 of the tallest bar. */ ratio: number };

export type EarningsChart = {
  bars: ChartBar[];
  /** The largest daily amount in the series: the top of the axis. 0 when nothing was earned. */
  max: number;
  /** False when every day is zero — the screen then shows an empty state, not a flat chart. */
  hasEarnings: boolean;
};

/** One bar per day the server sent, in its order. A negative or unreadable day draws as an empty bar. */
export function earningsChart(series: SeriesPoint[] | null | undefined): EarningsChart {
  const points = Array.isArray(series) ? series : [];
  const amounts = points.map((p) => (typeof p.amount === "number" && Number.isFinite(p.amount) ? p.amount : 0));
  const max = amounts.reduce((m, a) => (a > m ? a : m), 0);
  return {
    bars: points.map((p, i) => {
      const amount = amounts[i] ?? 0;
      return { date: p.date, amount, ratio: max > 0 && amount > 0 ? amount / max : 0 };
    }),
    max,
    hasEarnings: max > 0,
  };
}

export type BreakdownRow = { stars: number; count: number; /** 0–1 of the largest count. */ ratio: number };

/**
 * The reviews answer's `ratingBreakdown` ("5".."1" → how many reviews), top star first. The counts
 * are the server's; `ratio` only sets the width of each bar. No average is computed.
 */
export function ratingBreakdownRows(breakdown: Record<string, number> | null | undefined): BreakdownRow[] {
  const counts = [5, 4, 3, 2, 1].map((stars) => {
    const raw = breakdown?.[String(stars)];
    return { stars, count: typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0 };
  });
  const max = counts.reduce((m, c) => (c.count > m ? c.count : m), 0);
  return counts.map((c) => ({ ...c, ratio: max > 0 ? c.count / max : 0 }));
}

/** The first `shown` items and how many more the app is holding back (never how many the server has). */
export function pageOf<T>(items: T[] | null | undefined, shown: number): { visible: T[]; hidden: number } {
  const all = Array.isArray(items) ? items : [];
  const visible = all.slice(0, Math.max(0, shown));
  return { visible, hidden: all.length - visible.length };
}
