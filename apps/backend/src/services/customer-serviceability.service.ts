/**
 * Whether a customer can book a service at one of THEIR addresses, optionally on a date.
 *
 * Composes checks that already decide this elsewhere (bookability, the service's city / PIN-code
 * coverage, the service zones, the day's slots) and reduces them to the customer-facing status in
 * lib/customer-serviceability. It is an early answer for the booking page; the quote and the
 * booking request run the same checks again and remain the authority.
 */
import prisma from "../lib/prisma";
import { customerServiceability, type CustomerServiceability } from "../lib/customer-serviceability";
import { coverageAllowsAddress } from "../lib/service-catalog-config";
import { loadHydratedCatalog } from "../lib/service-catalog-store";
import { assertBookable, CUSTOMER_CATALOG_WHERE } from "../lib/service-domain";
import { knownCoords } from "../lib/geo-unknown";
import { geofenceService } from "./geofence.service";
import { mapsService } from "./maps.service";
import { serviceAvailabilityService } from "./service-availability.service";

export async function serviceabilityForCustomer(
  userId: string,
  serviceRef: string,
  query: { addressId?: string; date?: string },
): Promise<{ ok: true; result: CustomerServiceability } | { ok: false; error: "SERVICE_NOT_FOUND" | "ADDRESS_NOT_FOUND" | "ADDRESS_REQUIRED" | "INVALID_DATE" }> {
  if (!query.addressId) return { ok: false, error: "ADDRESS_REQUIRED" };
  if (query.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(query.date)) return { ok: false, error: "INVALID_DATE" };

  const byRef = { OR: [{ id: serviceRef }, { slug: serviceRef }] };
  // A service in the customer catalogue, or one that was and is paused. Drafts, services in review
  // and archived services are not disclosed: asking about them is the same as asking about nothing.
  const service =
    (await prisma.service.findFirst({ where: { AND: [byRef, CUSTOMER_CATALOG_WHERE] } })) ??
    (await prisma.service.findFirst({ where: { AND: [byRef, { lifecycleStatus: "PAUSED" }] } }));
  if (!service) return { ok: false, error: "SERVICE_NOT_FOUND" };

  const address = await prisma.address.findFirst({
    where: { id: query.addressId, userId },
    select: { city: true, zipCode: true, latitude: true, longitude: true },
  });
  if (!address) return { ok: false, error: "ADDRESS_NOT_FOUND" };

  const cfg = await loadHydratedCatalog(service);
  const bookable = assertBookable(service, cfg).ok;
  const coverageAllowed = coverageAllowsAddress(service, cfg, { city: address.city, zipCode: address.zipCode }).ok;
  // An address saved without a real map pin holds 0,0: that is "unknown", not a place (lib/geo-unknown).
  const point = knownCoords(address.latitude, address.longitude);
  const hasCoordinates = point !== null;

  let inServiceArea: boolean | null = null;
  if (point) {
    try {
      inServiceArea = mapsService.isWithinIndia(point.latitude, point.longitude)
        ? (await geofenceService.isServiceable(point.latitude, point.longitude, service.category)).serviceable
        : false;
    } catch {
      inServiceArea = null; // The check could not run: the customer is told it needs confirmation, not "no".
    }
  }

  let slots: { total: number; available: number } | null = null;
  if (query.date && bookable && coverageAllowed && inServiceArea === true) {
    const day = await serviceAvailabilityService.getDaySlots({ serviceId: service.id, date: query.date, userId, addressId: query.addressId });
    if (day.ok) slots = { total: day.slots.length, available: day.availableCount };
  }

  return { ok: true, result: customerServiceability({ bookable, hasCoordinates, inServiceArea, coverageAllowed, slots }) };
}
