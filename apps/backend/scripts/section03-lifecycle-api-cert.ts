/**
 * Section 03 lifecycle API certification — drives bookingService transitions with real DB.
 * Proximity inside radius, outside blocked, complete earnings.
 *
 * Usage: cd apps/backend && bun run scripts/section03-lifecycle-api-cert.ts
 *
 * Expands the same fixtures pattern as section03-db-cert.ts (complete/evidence/chat)
 * with arrive/start proximity gates. Does NOT invent a second FSM.
 */
import "dotenv/config";
import { requireDeclaredTarget } from "./lib/script-target";
import { BookingStatus, PaymentStatus, PrismaClient } from "@prisma/client";
requireDeclaredTarget({ label: "section03-lifecycle-api-cert" });

const prisma = new PrismaClient();
const RUN = `s03l-${Date.now().toString(36)}`;
let failed = 0;

const JOB_LAT = 12.97;
const JOB_LNG = 77.59;
/** Well inside default arrivalRadiusM (100m). */
const INSIDE = { lat: 12.9701, lng: 77.5901 };
/** Delhi — far outside Bengaluru job radius. */
const OUTSIDE = { lat: 28.61, lng: 77.2 };

function gate(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const { bookingService } = await import("../src/services/booking.service");

  const customer = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION",
      firstName: "S03L",
      lastName: "Customer",
      phoneNumber: `+9199${String(Date.now()).slice(-8)}`,
      password: "test-hash",
      role: "CUSTOMER",
    },
  });
  const providerUser = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION",
      firstName: "S03L",
      lastName: "Partner",
      phoneNumber: `+9198${String(Date.now()).slice(-8)}`,
      password: "test-hash",
      role: "VENDOR",
    },
  });
  const service = await prisma.service.findFirst({ where: { isActive: true } });
  if (!service) throw new Error("No active service");
  const address = await prisma.address.create({
    data: {
      userId: customer.id,
      label: "Home",
      addressLine1: "12 Test Lane",
      city: "Bengaluru",
      state: "KA",
      zipCode: "560001",
      latitude: JOB_LAT,
      longitude: JOB_LNG,
      fullAddress: "12 Test Lane, Bengaluru",
    },
  });
  const provider = await prisma.provider.create({
    data: {
      userId: providerUser.id,
      businessName: `S03L Biz ${RUN}`,
      isApproved: true,
      isVerified: true,
      isActive: true,
      isOnline: true,
    },
  });

  const booking = await prisma.booking.create({
    data: { dataOrigin: "CERTIFICATION",
      bookingNumber: `S03L-${RUN}`,
      userId: customer.id,
      providerId: provider.id,
      serviceId: service.id,
      addressId: address.id,
      status: BookingStatus.ACCEPTED,
      paymentStatus: PaymentStatus.SUCCESS,
      scheduledDate: new Date(),
      baseAmount: 499,
      finalAmount: 499,
      totalAmount: 499,
      acceptedAt: new Date(),
    },
  });

  // En-route may use soft coords (no radius enforce on markEnRoute).
  const en = await bookingService.markEnRoute(provider.id, booking.id, 0, 0);
  gate("en_route.soft_coords", en.ok === true && en.ok && en.newlyTransitioned === true);

  // Arrive with 0,0 blocked
  const nullIsland = await bookingService.markArrived(provider.id, booking.id, 0, 0);
  gate(
    "arrive.null_island_blocked",
    !nullIsland.ok && nullIsland.error === "LOCATION_INVALID",
  );

  // Arrive outside radius blocked
  const far = await bookingService.markArrived(provider.id, booking.id, OUTSIDE.lat, OUTSIDE.lng);
  gate(
    "arrive.outside_blocked",
    !far.ok && far.error === "OUTSIDE_SERVICE_AREA",
  );

  // Arrive inside radius
  const near = await bookingService.markArrived(provider.id, booking.id, INSIDE.lat, INSIDE.lng);
  gate("arrive.inside_ok", near.ok === true && near.ok && near.newlyTransitioned === true);

  let startOutsideBlocked = false;
  try {
    await bookingService.start(provider.id, booking.id, OUTSIDE.lat, OUTSIDE.lng);
  } catch (e) {
    startOutsideBlocked = e instanceof Error && e.message === "OUTSIDE_SERVICE_AREA";
  }
  gate("start.outside_blocked", startOutsideBlocked);

  let startNullBlocked = false;
  try {
    await bookingService.start(provider.id, booking.id, 0, 0);
  } catch (e) {
    startNullBlocked =
      e instanceof Error &&
      (e.message === "LOCATION_INVALID" || e.message === "LOCATION_REQUIRED");
  }
  gate("start.null_island_blocked", startNullBlocked);

  const started = await bookingService.start(provider.id, booking.id, INSIDE.lat, INSIDE.lng);
  gate(
    "start.inside_ok",
    String(started.status).toUpperCase() === "IN_PROGRESS" && started.startedAt != null,
  );

  const completed = await bookingService.complete(
    provider.id,
    booking.id,
    INSIDE.lat,
    INSIDE.lng,
    "s03 lifecycle done",
  );
  gate(
    "complete.earnings",
    completed.newlyCompleted === true &&
      String(completed.booking.status).toUpperCase() === "COMPLETED",
  );
  const earnings = await prisma.earning.count({ where: { bookingId: booking.id } });
  gate("complete.single_earning", earnings === 1, `count=${earnings}`);

  console.log(
    failed === 0
      ? "\nSECTION 03 LIFECYCLE API CERT: FULL PASS"
      : `\nSECTION 03 LIFECYCLE API CERT: ${failed} FAIL(S)`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
