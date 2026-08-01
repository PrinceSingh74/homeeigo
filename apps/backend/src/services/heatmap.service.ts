import prisma from "../lib/prisma";
import { cacheService } from "./cache.service";

/**
 * Phase 16.4 — demand/supply heatmap via Float-grid aggregation (NO PostGIS, no new
 * tables, no materialized view). Buckets existing bookings (demand/revenue/cancellation)
 * and provider locations (supply) into square grid cells computed on read.
 */
export type HeatmapCell = {
  lat: number;
  lng: number;
  demand: number; // bookings in window
  completed: number;
  cancelled: number;
  cancellationRate: number; // 0..1
  revenue: number; // ₹ from settled bookings
  supplyOnline: number; // online providers in cell
  supplyTotal: number;
  demandScore: number; // 0..100 (relative to busiest cell)
  supplyGap: number; // demand - onlineSupply (positive = under-served)
};

const ALLOWED_GRID = [0.01, 0.02, 0.05, 0.1] as const; // ~1.1 / 2.2 / 5.5 / 11 km

export const heatmapService = {
  async generate(opts?: {
    gridSize?: number;
    days?: number;
    bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  }): Promise<{ gridSize: number; days: number; cells: HeatmapCell[]; totals: { demand: number; revenue: number; supplyOnline: number; cells: number } }> {
    const safeGrid = ALLOWED_GRID.includes(opts?.gridSize as (typeof ALLOWED_GRID)[number])
      ? opts!.gridSize!
      : 0.05;
    const days = Math.min(365, Math.max(1, opts?.days ?? 30));
    const bb = opts?.bbox;
    const cacheKey = `heatmap:${safeGrid}:${days}:${bb ? `${bb.minLat},${bb.minLng},${bb.maxLat},${bb.maxLng}` : "all"}`;
    return cacheService.getOrFetch(cacheKey, 60, () => this.generateUncached(opts), 10);
  },

  async generateUncached(opts?: {
    gridSize?: number;
    days?: number;
    bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  }): Promise<{ gridSize: number; days: number; cells: HeatmapCell[]; totals: { demand: number; revenue: number; supplyOnline: number; cells: number } }> {
    const safeGrid = ALLOWED_GRID.includes(opts?.gridSize as (typeof ALLOWED_GRID)[number])
      ? opts!.gridSize!
      : 0.05;
    const days = Math.min(365, Math.max(1, opts?.days ?? 30));
    const bb = opts?.bbox;
    const bboxBookings =
      bb &&
      Number.isFinite(bb.minLat) &&
      Number.isFinite(bb.maxLat) &&
      Number.isFinite(bb.minLng) &&
      Number.isFinite(bb.maxLng)
        ? `AND a.latitude BETWEEN ${bb.minLat} AND ${bb.maxLat} AND a.longitude BETWEEN ${bb.minLng} AND ${bb.maxLng}`
        : "";
    const bboxProviders =
      bb &&
      Number.isFinite(bb.minLat) &&
      Number.isFinite(bb.maxLat) &&
      Number.isFinite(bb.minLng) &&
      Number.isFinite(bb.maxLng)
        ? `AND l.latitude BETWEEN ${bb.minLat} AND ${bb.maxLat} AND l.longitude BETWEEN ${bb.minLng} AND ${bb.maxLng}`
        : "";

    // Demand / revenue / cancellation per cell (bookings ⋈ addresses).
    const demandRows = await prisma.$queryRawUnsafe<
      Array<{ cell_lat: number; cell_lng: number; bookings: bigint; completed: bigint; cancelled: bigint; revenue: number }>
    >(`
      SELECT floor(a.latitude / ${safeGrid}) * ${safeGrid} AS cell_lat,
             floor(a.longitude / ${safeGrid}) * ${safeGrid} AS cell_lng,
             count(*) AS bookings,
             count(*) FILTER (WHERE b.status = 'COMPLETED') AS completed,
             count(*) FILTER (WHERE b.status IN ('CANCELLED_BY_USER','CANCELLED_BY_PROVIDER','REJECTED')) AS cancelled,
             coalesce(sum(b.final_amount) FILTER (WHERE b.payment_status = 'SUCCESS'), 0) AS revenue
      FROM bookings b
      JOIN addresses a ON a.id = b.address_id
      WHERE b.created_at > now() - interval '${days} days'
        AND a.latitude IS NOT NULL AND a.longitude IS NOT NULL
        ${bboxBookings}
      GROUP BY cell_lat, cell_lng
    `);

    // Supply per cell (providers ⋈ current location).
    const supplyRows = await prisma.$queryRawUnsafe<
      Array<{ cell_lat: number; cell_lng: number; online: bigint; total: bigint }>
    >(`
      SELECT floor(l.latitude / ${safeGrid}) * ${safeGrid} AS cell_lat,
             floor(l.longitude / ${safeGrid}) * ${safeGrid} AS cell_lng,
             count(DISTINCT p.id) FILTER (WHERE p.is_online) AS online,
             count(DISTINCT p.id) AS total
      FROM providers p
      JOIN locations l ON l.provider_id = p.id
      WHERE p.is_active AND p.is_approved
        ${bboxProviders}
      GROUP BY cell_lat, cell_lng
    `);

    const cells = new Map<string, HeatmapCell>();
    const key = (la: number, ln: number) => `${la.toFixed(4)}_${ln.toFixed(4)}`;
    const round4 = (n: number) => Math.round(n * 10000) / 10000;

    for (const r of demandRows) {
      const lat = round4(Number(r.cell_lat));
      const lng = round4(Number(r.cell_lng));
      const demand = Number(r.bookings);
      const cancelled = Number(r.cancelled);
      cells.set(key(lat, lng), {
        lat,
        lng,
        demand,
        completed: Number(r.completed),
        cancelled,
        cancellationRate: demand > 0 ? Math.round((cancelled / demand) * 100) / 100 : 0,
        revenue: Math.round(Number(r.revenue)),
        supplyOnline: 0,
        supplyTotal: 0,
        demandScore: 0,
        supplyGap: demand,
      });
    }
    for (const r of supplyRows) {
      const lat = round4(Number(r.cell_lat));
      const lng = round4(Number(r.cell_lng));
      const k = key(lat, lng);
      const existing = cells.get(k);
      const online = Number(r.online);
      if (existing) {
        existing.supplyOnline = online;
        existing.supplyTotal = Number(r.total);
        existing.supplyGap = existing.demand - online;
      } else {
        cells.set(k, { lat, lng, demand: 0, completed: 0, cancelled: 0, cancellationRate: 0, revenue: 0, supplyOnline: online, supplyTotal: Number(r.total), demandScore: 0, supplyGap: -online });
      }
    }

    const list = [...cells.values()];
    const maxDemand = list.reduce((m, c) => Math.max(m, c.demand), 0);
    for (const c of list) c.demandScore = maxDemand > 0 ? Math.round((c.demand / maxDemand) * 100) : 0;
    list.sort((a, b) => b.demandScore - a.demandScore || b.revenue - a.revenue);

    return {
      gridSize: safeGrid,
      days,
      cells: list,
      totals: {
        demand: list.reduce((s, c) => s + c.demand, 0),
        revenue: list.reduce((s, c) => s + c.revenue, 0),
        supplyOnline: list.reduce((s, c) => s + c.supplyOnline, 0),
        cells: list.length,
      },
    };
  },
};
