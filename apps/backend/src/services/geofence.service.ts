import prisma from "../lib/prisma";
import { distanceKm } from "../lib/geo";
import { roomManager } from "../lib/websocket";
import { logger } from "../lib/logger";
import { recordFeatureEvent, incCounter } from "../lib/metrics";

/**
 * Phase 16.3 — Geofencing on Float + haversine (NO PostGIS). A geofence is a circle
 * (centre + radius in metres); containment = haversine distance ≤ radius. Enter/exit
 * transitions are detected per subject and serialised with an advisory lock so concurrent
 * location pings never produce duplicate ENTER events.
 */
export type GeoSubject = { userId?: string; providerId?: string };

type GeofenceLite = {
  id: string;
  name: string;
  zoneType: string;
  shape?: string | null;
  polygon?: unknown;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  serviceCategories: string[];
  surgeMultiplier: number;
  city: string | null;
  state: string | null;
};

function subjectKey(s: GeoSubject): string {
  return s.providerId ? `p:${s.providerId}` : `u:${s.userId ?? "anon"}`;
}

function distanceMeters(g: { centerLat: number; centerLng: number }, lat: number, lng: number): number {
  return distanceKm(g.centerLat, g.centerLng, lat, lng) * 1000;
}

/** Ray-casting point-in-polygon (lng=x, lat=y). Ring is an ordered list of {lat,lng}. */
function pointInPolygon(lat: number, lng: number, ring: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.lng, yi = ring[i]!.lat;
    const xj = ring[j]!.lng, yj = ring[j]!.lat;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function categoryMatches(g: GeofenceLite, serviceCategory?: string): boolean {
  return !serviceCategory || g.serviceCategories.length === 0 || g.serviceCategories.includes(serviceCategory);
}

export const geofenceService = {
  containsPoint(
    g: { centerLat: number; centerLng: number; radiusMeters: number; shape?: string | null; polygon?: unknown },
    lat: number,
    lng: number,
  ): boolean {
    if (g.shape === "POLYGON" && Array.isArray(g.polygon) && g.polygon.length >= 3) {
      return pointInPolygon(lat, lng, g.polygon as Array<{ lat: number; lng: number }>);
    }
    return distanceMeters(g, lat, lng) <= g.radiusMeters;
  },

  /** All active geofences whose circle contains the point (optionally category-filtered). */
  async findContaining(lat: number, lng: number, opts?: { serviceCategory?: string; zoneType?: string }): Promise<Array<GeofenceLite & { distanceMeters: number }>> {
    const where: { isActive: boolean; zoneType?: string } = { isActive: true };
    if (opts?.zoneType) where.zoneType = opts.zoneType;
    const active = (await prisma.geofence.findMany({ where })) as unknown as GeofenceLite[];
    return active
      .filter((g) => this.containsPoint(g, lat, lng) && categoryMatches(g, opts?.serviceCategory))
      .map((g) => ({ ...g, distanceMeters: Math.round(distanceMeters(g, lat, lng)) }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  },

  /**
   * Is this location serviceable? If SERVICE_ZONE geofences are configured, the point must
   * fall inside at least one (matching the category). If NONE are configured, default to
   * serviceable so geofencing is opt-in and never silently blocks bookings.
   */
  async isServiceable(lat: number, lng: number, serviceCategory?: string): Promise<{ serviceable: boolean; configured: boolean; surgeMultiplier: number; zones: Array<{ id: string; name: string }> }> {
    const zones = (await prisma.geofence.findMany({ where: { isActive: true, zoneType: "SERVICE_ZONE" } })) as unknown as GeofenceLite[];
    const configured = zones.length > 0;
    const inside = zones.filter((g) => this.containsPoint(g, lat, lng) && categoryMatches(g, serviceCategory));
    const surgeMultiplier = inside.reduce((m, g) => Math.max(m, g.surgeMultiplier), 1);
    return {
      serviceable: configured ? inside.length > 0 : true,
      configured,
      surgeMultiplier,
      zones: inside.map((g) => ({ id: g.id, name: g.name })),
    };
  },

  /**
   * Record a subject's position, diff it against their last known zone membership, and
   * append ENTER/EXIT events for the transitions. Advisory-locked per subject → no
   * duplicate ENTER under concurrent pings.
   */
  async evaluate(subject: GeoSubject, lat: number, lng: number): Promise<{ inside: Array<{ id: string; name: string }>; entered: Array<{ id: string; name: string }>; exited: Array<{ id: string; name: string }> }> {
    const subjKey = subjectKey(subject);
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"geofence:" + subjKey}))`;

        const active = (await tx.geofence.findMany({ where: { isActive: true } })) as unknown as GeofenceLite[];
        const insideNow = active.filter((g) => this.containsPoint(g, lat, lng));
        const insideIds = new Set(insideNow.map((g) => g.id));

        const subjectWhere = subject.providerId ? { providerId: subject.providerId } : { userId: subject.userId };
        const recent = await tx.geofenceEvent.findMany({ where: subjectWhere, orderBy: { createdAt: "desc" }, take: 300, select: { geofenceId: true, eventType: true, createdAt: true } });
        const lastByGeofence = new Map<string, string>();
        // Most-recent ENTER/EXIT timestamp per geofence → 5-minute duplicate suppression.
        const lastEnterAt = new Map<string, number>();
        const lastExitAt = new Map<string, number>();
        for (const e of recent) {
          if (!lastByGeofence.has(e.geofenceId)) lastByGeofence.set(e.geofenceId, e.eventType);
          if (e.eventType === "ENTER" && !lastEnterAt.has(e.geofenceId)) lastEnterAt.set(e.geofenceId, e.createdAt.getTime());
          if (e.eventType === "EXIT" && !lastExitAt.has(e.geofenceId)) lastExitAt.set(e.geofenceId, e.createdAt.getTime());
        }
        const FIVE_MIN = 5 * 60 * 1000;
        const now = Date.now();
        const enteredWithin5 = (gid: string) => now - (lastEnterAt.get(gid) ?? -Infinity) < FIVE_MIN;
        const exitedWithin5 = (gid: string) => now - (lastExitAt.get(gid) ?? -Infinity) < FIVE_MIN;

        const entered: GeofenceLite[] = [];
        const exited: GeofenceLite[] = [];
        const byId = new Map(active.map((g) => [g.id, g]));

        for (const g of insideNow) {
          // ENTER once per stay (last event ≠ ENTER) AND not within the 5-min suppression window.
          if (lastByGeofence.get(g.id) !== "ENTER" && !enteredWithin5(g.id)) {
            await tx.geofenceEvent.create({ data: { geofenceId: g.id, userId: subject.userId ?? null, providerId: subject.providerId ?? null, eventType: "ENTER", latitude: lat, longitude: lng } });
            incCounter("geofence_enter_total");
            entered.push(g);
          }
        }
        for (const [gid, last] of lastByGeofence) {
          if (last === "ENTER" && !insideIds.has(gid) && !exitedWithin5(gid)) {
            await tx.geofenceEvent.create({ data: { geofenceId: gid, userId: subject.userId ?? null, providerId: subject.providerId ?? null, eventType: "EXIT", latitude: lat, longitude: lng } });
            incCounter("geofence_exit_total");
            const g = byId.get(gid);
            exited.push(g ?? ({ id: gid, name: "" } as GeofenceLite));
          }
        }
        return { insideNow, entered, exited };
      },
      { isolationLevel: "Serializable" },
    );

    // Best-effort realtime fan-out of transitions (never blocks the location update).
    const emit = (g: GeofenceLite | { id: string; name: string }, eventType: "ENTER" | "EXIT") => {
      try {
        roomManager.broadcast(`geofence:${subjKey}`, {
          type: eventType === "ENTER" ? "GEOFENCE_ENTER" : "GEOFENCE_EXIT",
          data: { geofenceId: g.id, geofenceName: g.name, eventType, timestamp: new Date().toISOString() },
          timestamp: new Date(),
        });
      } catch (e) {
        logger.warn("geofence.ws_emit_failed", { error: e instanceof Error ? e.message : String(e) });
      }
    };
    for (const g of result.entered) {
      emit(g, "ENTER");
      recordFeatureEvent("geofence", "enter");
    }
    for (const g of result.exited) {
      emit(g, "EXIT");
      recordFeatureEvent("geofence", "exit");
    }

    const lite = (g: GeofenceLite | { id: string; name: string }) => ({ id: g.id, name: g.name });
    return { inside: result.insideNow.map(lite), entered: result.entered.map(lite), exited: result.exited.map(lite) };
  },

  // --- Admin CRUD ---
  async create(input: { name: string; zoneType?: string; shape?: string; polygon?: Array<{ lat: number; lng: number }>; city?: string; state?: string; centerLat: number; centerLng: number; radiusMeters: number; serviceCategories?: string[]; surgeMultiplier?: number }) {
    const isPolygon = input.shape === "POLYGON" && Array.isArray(input.polygon) && input.polygon.length >= 3;
    // For a polygon, derive a bounding centre + radius so circle-based queries still work.
    let centerLat = input.centerLat, centerLng = input.centerLng, radiusMeters = input.radiusMeters;
    if (isPolygon) {
      const pts = input.polygon!;
      centerLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      centerLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
      radiusMeters = Math.max(...pts.map((p) => distanceKm(centerLat, centerLng, p.lat, p.lng) * 1000), 100);
    }
    return prisma.geofence.create({
      data: {
        name: input.name,
        zoneType: input.zoneType ?? "SERVICE_ZONE",
        shape: isPolygon ? "POLYGON" : "CIRCLE",
        polygon: isPolygon ? (input.polygon as unknown as object) : undefined,
        city: input.city,
        state: input.state,
        centerLat,
        centerLng,
        radiusMeters,
        serviceCategories: input.serviceCategories ?? [],
        surgeMultiplier: input.surgeMultiplier ?? 1,
      },
    });
  },

  async list(opts?: { city?: string; zoneType?: string; activeOnly?: boolean }) {
    return prisma.geofence.findMany({
      where: {
        ...(opts?.activeOnly ? { isActive: true } : {}),
        ...(opts?.city ? { city: opts.city } : {}),
        ...(opts?.zoneType ? { zoneType: opts.zoneType } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  },

  async update(id: string, patch: Partial<{ name: string; radiusMeters: number; centerLat: number; centerLng: number; serviceCategories: string[]; surgeMultiplier: number; isActive: boolean; zoneType: string; city: string; state: string }>) {
    return prisma.geofence.update({ where: { id }, data: patch });
  },

  async remove(id: string) {
    await prisma.geofence.delete({ where: { id } });
    return { ok: true };
  },

  /** Admin — paginated geofence event log (ENTER/EXIT), newest first. */
  async listEvents(opts?: { geofenceId?: string; userId?: string; eventType?: string; limit?: number }) {
    return prisma.geofenceEvent.findMany({
      where: {
        ...(opts?.geofenceId ? { geofenceId: opts.geofenceId } : {}),
        ...(opts?.userId ? { userId: opts.userId } : {}),
        ...(opts?.eventType ? { eventType: opts.eventType } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(200, Math.max(1, opts?.limit ?? 100)),
      include: { geofence: { select: { name: true, city: true } } },
    });
  },

  // Spec-named aliases (containsPoint / evaluate) for API parity.
  pointInGeofence(g: { centerLat: number; centerLng: number; radiusMeters: number }, lat: number, lng: number): boolean {
    return this.containsPoint(g, lat, lng);
  },
  async processLocationUpdate(subject: GeoSubject, lat: number, lng: number) {
    return this.evaluate(subject, lat, lng);
  },

  /**
   * Per-zone analytics (last 24h): supply (online providers inside), demand (bookings
   * whose address is inside), revenue (completed-booking value inside), utilization
   * (demand ÷ supply). Supports both circle and polygon zones.
   */
  async zoneAnalytics(): Promise<Array<{
    id: string; name: string; city: string | null; zoneType: string; shape: string;
    surgeMultiplier: number; supply: number; demand: number; revenue: number; utilization: number;
    completed: number; cancelled: number;
  }>> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [zones, providerLocs, bookings] = await Promise.all([
      prisma.geofence.findMany({ where: { isActive: true } }) as unknown as Promise<GeofenceLite[]>,
      prisma.location.findMany({ where: { provider: { isOnline: true } }, select: { latitude: true, longitude: true } }),
      prisma.booking.findMany({
        where: { createdAt: { gte: since } },
        select: { status: true, finalAmount: true, address: { select: { latitude: true, longitude: true } } },
      }),
    ]);
    return zones.map((z) => {
      const supply = providerLocs.filter((p) => this.containsPoint(z, p.latitude, p.longitude)).length;
      let demand = 0, revenue = 0, completed = 0, cancelled = 0;
      for (const b of bookings) {
        if (!b.address || !this.containsPoint(z, b.address.latitude, b.address.longitude)) continue;
        demand += 1;
        if (b.status === "COMPLETED") { completed += 1; revenue += b.finalAmount ?? 0; }
        if (b.status === "CANCELLED_BY_USER" || b.status === "CANCELLED_BY_PROVIDER") cancelled += 1;
      }
      return {
        id: z.id, name: z.name, city: z.city, zoneType: z.zoneType, shape: z.shape ?? "CIRCLE",
        surgeMultiplier: z.surgeMultiplier, supply, demand, revenue: Math.round(revenue),
        utilization: supply > 0 ? Math.round((demand / supply) * 100) / 100 : demand > 0 ? demand : 0,
        completed, cancelled,
      };
    });
  },
};
