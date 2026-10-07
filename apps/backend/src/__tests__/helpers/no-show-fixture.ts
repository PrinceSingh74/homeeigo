import prisma from "../../lib/prisma";

let slot = 0;

/**
 * Puts a fixture booking where a customer no-show can honestly be reported from: the appointment
 * has begun (a no-show is counted from the later of the arrival and the booked time), and the
 * server holds the partner's position at the job right now (a report that charges a fee is made
 * from the door).
 *
 * `appointmentStarted: false` leaves the booked time in the future; `partnerAtAddress: false`
 * leaves the server holding no position for the partner.
 */
export async function placeAtDoor(
  bookingId: string,
  providerId: string,
  opts: { appointmentStarted?: boolean; partnerAtAddress?: boolean } = {},
): Promise<void> {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { address: { select: { latitude: true, longitude: true } } } });
  if (opts.appointmentStarted !== false) {
    // A distinct past slot per booking (the provider's slots may not overlap), each well before any arrival a test sets.
    slot += 1;
    await prisma.booking.update({ where: { id: bookingId }, data: { scheduledDate: new Date(Date.now() - (6 + slot * 3) * 3_600_000) } });
  }
  const at = opts.partnerAtAddress === false ? null : booking.address;
  await prisma.partnerPresence.updateMany({
    where: { providerId },
    data: at
      ? { lastLocationLat: at.latitude, lastLocationLng: at.longitude, lastLocationAt: new Date(Date.now() - 3_000), lastLocationReceivedAt: new Date() }
      : { lastLocationLat: null, lastLocationLng: null, lastLocationAt: null, lastLocationReceivedAt: null },
  });
}
