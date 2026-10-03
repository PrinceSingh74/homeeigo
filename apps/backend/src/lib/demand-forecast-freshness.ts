/**
 * One definition of "stale demand forecast", shared by shift planning, geo-intelligence,
 * executive intelligence, forecast explanation and demand/supply warnings.
 *
 * Lives in lib/ (a leaf) rather than in shift-planning.service so that geo-intelligence can ask the
 * question without importing shift-planning — which imports earnings-coach, which imports
 * partner-intelligence, which imports geo-intelligence. That import cycle was load-order-masked
 * and is now gone.
 */

/**
 * One day, because the model produces hourly points: once the horizon has fully elapsed the points
 * describe hours that have already happened. This is a reporting threshold, not a filter — the
 * forecast is still returned, labelled, so a caller can see why it was not used for timing.
 */
export const DEMAND_STALE_AFTER_HOURS = 24;

/**
 * Whether a demand forecast has aged past the point of describing the future.
 *
 * The rule is about the forecast's own horizon, not about when it was fetched: a model refreshed
 * five minutes ago whose last predicted hour is yesterday is stale, and one fetched some time ago
 * whose points still run into tonight is not. `observedAt` is only the fallback for a forecast that
 * carries no points to read a horizon from, and an unparseable horizon reads as stale rather than
 * fresh — an unknown age is not evidence of youth.
 */
export function isDemandForecastStale(
  observedAt: string | null,
  value: { points?: unknown[] } | null,
  now: number = Date.now(),
): boolean {
  const points = (value?.points ?? []) as Array<{ hour?: string }>;
  const last = points[points.length - 1]?.hour;
  if (!last) {
    return observedAt ? now - Date.parse(observedAt) > DEMAND_STALE_AFTER_HOURS * 3_600_000 : true;
  }
  const lastMs = Date.parse(String(last).replace(" ", "T") + "Z");
  if (Number.isNaN(lastMs)) return true;
  return now - lastMs > DEMAND_STALE_AFTER_HOURS * 3_600_000;
}
