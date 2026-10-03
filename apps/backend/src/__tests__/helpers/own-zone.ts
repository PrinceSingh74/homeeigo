/**
 * A zone owned by one test file.
 *
 * The geo-intel surge / zone signals are built from ACTIVE geofences, and cached for up to two minutes.
 * Suites that asserted "at least one zone" relied on some other suite having created a geofence earlier
 * in the run — so on a freshly reset database (what CI starts from) they failed whenever they ran first,
 * and passed only in a populated one. This gives such a file its own active geofence through the real
 * service, and clears the cached signals on the way in and out so no earlier snapshot can hide it.
 */
import prisma from "../../lib/prisma";
import { geofenceService } from "../../services/geofence.service";
import { cacheService } from "../../services/cache.service";

const GEO_INTEL_KEYS = ["geo-intel:surge-prediction", "geo-intel:zone-scoring:v2"];

async function clearGeoIntelCache() {
  for (const key of GEO_INTEL_KEYS) await cacheService.invalidate(key).catch(() => undefined);
}

export async function seedOwnZone(tag: string): Promise<string> {
  const zone = await geofenceService.create({
    name: `Test zone ${tag}`,
    zoneType: "SERVICE_ZONE",
    city: "Noida",
    centerLat: 28.5355,
    centerLng: 77.391,
    radiusMeters: 2500,
  });
  await clearGeoIntelCache();
  return zone.id;
}

export async function removeOwnZone(id: string | null): Promise<void> {
  if (!id) return;
  await prisma.geofenceEvent.deleteMany({ where: { geofenceId: id } }).catch(() => undefined);
  await prisma.geofence.delete({ where: { id } }).catch(() => undefined);
  await clearGeoIntelCache();
}
