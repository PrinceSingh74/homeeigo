import { distanceKm, etaMinutes } from "../lib/geo";
import { mapsService } from "./maps.service";
import { observeFeatureLatency } from "../lib/metrics";

/**
 * Phase 17.3 — provider multi-stop route optimisation. Reuses `maps.service` for ETA /
 * Google Directions waypoint optimisation (traffic-aware) and falls back to a haversine
 * nearest-neighbour order when Google is unavailable. NOT a new routing engine.
 *
 * Priority: ARRIVED jobs (already on-site) are pinned first, then the remaining jobs are
 * ordered to minimise travel (nearest-neighbour), with earlier scheduled times biased
 * forward. Returns the optimised sequence plus distance / ETA / time-saved metrics.
 */
export type RouteJob = { bookingId: string; lat: number; lng: number; status?: string; scheduledDate?: string | Date };
export type RouteStop = { bookingId: string; order: number; lat: number; lng: number; status: string | null; distanceFromPrevKm: number; etaFromPrevMin: number; cumulativeEtaMin: number };

const SCHEDULE_BIAS_KM = 1.5; // each rank of "later scheduled" adds this much virtual distance

function legDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return distanceKm(a.lat, a.lng, b.lat, b.lng);
}

/** Greedy nearest-neighbour over a subset, biased by scheduled-time rank. Returns indices into `jobs`. */
function nearestNeighbourOrder(start: { lat: number; lng: number }, jobs: RouteJob[], subset: number[]): number[] {
  const scheduleRank = new Map<number, number>();
  [...subset]
    .sort((i, j) => new Date(jobs[i]!.scheduledDate ?? 0).getTime() - new Date(jobs[j]!.scheduledDate ?? 0).getTime())
    .forEach((idx, rank) => scheduleRank.set(idx, rank));

  const remaining = [...subset];
  const order: number[] = [];
  let cur: { lat: number; lng: number } = start;
  while (remaining.length) {
    let bestK = 0;
    let bestCost = Infinity;
    for (let k = 0; k < remaining.length; k++) {
      const j = jobs[remaining[k]!]!;
      const cost = legDistance(cur, j) + (scheduleRank.get(remaining[k]!) ?? 0) * SCHEDULE_BIAS_KM;
      if (cost < bestCost) {
        bestCost = cost;
        bestK = k;
      }
    }
    const idx = remaining.splice(bestK, 1)[0]!;
    order.push(idx);
    cur = jobs[idx]!;
  }
  return order;
}

function metricsFor(start: { lat: number; lng: number }, jobs: RouteJob[], order: number[]): { distanceKm: number; etaMin: number } {
  let dist = 0;
  let cur: { lat: number; lng: number } = start;
  for (const idx of order) {
    const j = jobs[idx]!;
    dist += legDistance(cur, j);
    cur = j;
  }
  return { distanceKm: Math.round(dist * 10) / 10, etaMin: etaMinutes(dist) };
}

export const routeOptimizationService = {
  async optimize(
    providerLocation: { lat: number; lng: number },
    jobs: RouteJob[],
  ): Promise<{ sequence: RouteStop[]; metrics: { stops: number; optimizedDistanceKm: number; optimizedEtaMin: number; naiveDistanceKm: number; naiveEtaMin: number; timeSavedMin: number; source: "google" | "haversine" }; polyline: string | null }> {
    const __t0 = Date.now();
    if (jobs.length === 0) {
      return { sequence: [], metrics: { stops: 0, optimizedDistanceKm: 0, optimizedEtaMin: 0, naiveDistanceKm: 0, naiveEtaMin: 0, timeSavedMin: 0, source: "haversine" }, polyline: null };
    }

    const arrived = jobs.map((_, i) => i).filter((i) => (jobs[i]!.status ?? "").toUpperCase() === "ARRIVED");
    const pending = jobs.map((_, i) => i).filter((i) => !arrived.includes(i));
    const arrivedOrdered = [...arrived].sort((a, b) => new Date(jobs[a]!.scheduledDate ?? 0).getTime() - new Date(jobs[b]!.scheduledDate ?? 0).getTime());
    // Start optimising the pending leg from the last pinned (arrived) stop, else the provider.
    const pendingStart = arrivedOrdered.length ? jobs[arrivedOrdered[arrivedOrdered.length - 1]!]! : providerLocation;

    let polyline: string | null = null;
    let source: "google" | "haversine" = "haversine";
    let pendingOrder: number[];

    const g = pending.length > 1 ? await mapsService.optimizeWaypoints(pendingStart, pending.map((i) => ({ lat: jobs[i]!.lat, lng: jobs[i]!.lng }))) : null;
    if (g) {
      pendingOrder = g.order.map((k) => pending[k]!);
      polyline = g.polyline;
      source = "google";
    } else {
      pendingOrder = nearestNeighbourOrder(pendingStart, jobs, pending);
    }

    const fullOrder = [...arrivedOrdered, ...pendingOrder];

    // Build the stop sequence with per-leg distance/ETA.
    const sequence: RouteStop[] = [];
    let cur: { lat: number; lng: number } = providerLocation;
    let cumEta = 0;
    fullOrder.forEach((idx, i) => {
      const j = jobs[idx]!;
      const legKm = Math.round(legDistance(cur, j) * 10) / 10;
      const legEta = etaMinutes(legDistance(cur, j));
      cumEta += legEta;
      sequence.push({ bookingId: j.bookingId, order: i, lat: j.lat, lng: j.lng, status: j.status ?? null, distanceFromPrevKm: legKm, etaFromPrevMin: legEta, cumulativeEtaMin: cumEta });
      cur = j;
    });

    const optimized = metricsFor(providerLocation, jobs, fullOrder);
    const naive = metricsFor(providerLocation, jobs, jobs.map((_, i) => i));
    observeFeatureLatency("route_optimize", (Date.now() - __t0) / 1000);
    return {
      sequence,
      metrics: {
        stops: jobs.length,
        optimizedDistanceKm: optimized.distanceKm,
        optimizedEtaMin: optimized.etaMin,
        naiveDistanceKm: naive.distanceKm,
        naiveEtaMin: naive.etaMin,
        timeSavedMin: Math.max(0, naive.etaMin - optimized.etaMin),
        source,
      },
      polyline,
    };
  },
};
