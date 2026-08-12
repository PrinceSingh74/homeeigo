/**
 * Full execution trace for latest PENDING booking with no provider.
 *   bun run scripts/trace-pending-booking.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { assignmentEngine } from "../src/services/assignment-engine.service";
import { matchingService } from "../src/services/matching.service";
import { bookingPriorityService } from "../src/services/booking-priority.service";
import { providerService } from "../src/services/provider.service";

const line = (s: string) => console.log(s);
const sep = () => line("─".repeat(72));

async function main() {
  sep();
  line("STEP 1 — bookings table (latest PENDING, provider_id NULL)");
  sep();

  const booking = await prisma.booking.findFirst({
    where: { status: "PENDING", providerId: null },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      service: { select: { id: true, name: true, slug: true } },
      address: true,
    },
  });

  if (!booking) {
    line("❌ No PENDING booking with provider_id=NULL found");
    await prisma.$disconnect();
    process.exit(1);
  }

  line(`booking_id       = ${booking.id}`);
  line(`booking_number   = ${booking.bookingNumber}`);
  line(`status           = ${booking.status}`);
  line(`provider_id      = ${booking.providerId ?? "NULL"}`);
  line(`service_id       = ${booking.serviceId} (${booking.service.name})`);
  line(`scheduled_date   = ${booking.scheduledDate.toISOString()}`);
  line(`queued_at        = ${booking.queuedAt?.toISOString() ?? "NULL"}`);
  line(`priority_score   = ${booking.priorityScore}`);
  line(`queue_priority   = ${booking.queuePriority}`);
  line(`address          = ${booking.address?.city ?? "N/A"} lat=${booking.address?.latitude} lng=${booking.address?.longitude}`);
  line(`created_at       = ${booking.createdAt.toISOString()}`);

  sep();
  line("STEP 2 — assignment_jobs table");
  sep();

  const job = await prisma.assignmentJob.findUnique({ where: { bookingId: booking.id } });
  if (!job) {
    line("❌ NO assignment_job for this booking");
  } else {
    line(`assignment_job_id = ${job.id}`);
    line(`status            = ${job.status}`);
    line(`dispatch_attempts = ${job.dispatchAttempts}/${job.maxAttempts}`);
    line(`current_provider  = ${job.currentProviderId ?? "NULL"}`);
    line(`timeout_at        = ${job.timeoutAt?.toISOString() ?? "NULL"}`);
    line(`created_at        = ${job.createdAt.toISOString()}`);
  }

  sep();
  line("STEP 3 — assignment_attempts table");
  sep();

  const attempts = job
    ? await prisma.assignmentAttempt.findMany({
        where: { jobId: job.id },
        orderBy: { dispatchedAt: "asc" },
        include: { provider: { select: { id: true, businessName: true, isOnline: true } } },
      })
    : [];

  if (attempts.length === 0) {
    line("❌ NO assignment_attempts");
  } else {
    for (const a of attempts) {
      line(`  attempt_id=${a.id} provider=${a.providerId} status=${a.status} dispatched=${a.dispatchedAt.toISOString()}`);
    }
  }

  sep();
  line("STEP 4-7 — All providers: online, service mapping, location, city");
  sep();

  const allProviders = await prisma.provider.findMany({
    where: { isActive: true, isApproved: true },
    include: {
      user: { select: { firstName: true, lastName: true, isBanned: true } },
      currentLocation: true,
    },
    orderBy: { createdAt: "desc" },
  });

  line(`Total active+approved providers: ${allProviders.length}`);
  for (const p of allProviders) {
    const hasService = p.serviceCategories.includes(booking.serviceId);
    const loc = p.currentLocation;
    const dist =
      loc && booking.address?.latitude && booking.address?.longitude
        ? haversine(booking.address.latitude, booking.address.longitude, loc.latitude, loc.longitude)
        : null;
    line(
      `  provider_id=${p.id.slice(0, 12)}… online=${p.isOnline} service_match=${hasService} ` +
        `city=${p.city ?? "NULL"} regions=${JSON.stringify(p.serviceRegions)} ` +
        `loc=${loc ? `${loc.latitude},${loc.longitude}` : "NONE"} dist_km=${dist?.toFixed(2) ?? "N/A"} ` +
        `working_days=${JSON.stringify(p.workingDays)} hours=${p.workingHoursStart}-${p.workingHoursEnd}`,
    );
  }

  sep();
  line("STEP 8 — dispatchToNextProvider() via matchingService.findBestProviders()");
  sep();

  const lat = booking.address?.latitude ?? 19.076;
  const lng = booking.address?.longitude ?? 72.8777;
  const matches = await matchingService.findBestProviders({
    serviceId: booking.serviceId,
    customerId: booking.userId,
    latitude: lat,
    longitude: lng,
    scheduledDate: booking.scheduledDate,
    maxResults: 15,
  });

  line(`Matching returned ${matches.length} available provider(s):`);
  for (const m of matches) {
    line(
      `  provider_id=${m.providerId} score=${m.totalScore} dist=${m.distance}km online=${m.isOnline} avail=${m.availability}`,
    );
  }
  if (matches.length === 0) {
    line("❌ FAIL: No eligible provider matched — dispatchToNextProvider would return false");
    const rawCandidates = await prisma.provider.findMany({
      where: {
        serviceCategories: { has: booking.serviceId },
        isActive: true,
        isApproved: true,
        user: { isBanned: false },
      },
      include: { currentLocation: true },
    });
    line(`  Raw candidates (service match only): ${rawCandidates.length}`);
    for (const c of rawCandidates) {
      const loc = c.currentLocation;
      const dist =
        loc && booking.address?.latitude
          ? haversine(booking.address.latitude, booking.address.longitude, loc.latitude, loc.longitude)
          : 999;
      line(`    ${c.id.slice(0, 12)}… online=${c.isOnline} loc=${loc ? "yes" : "NO"} dist=${dist.toFixed(1)}km`);
    }
  }

  sep();
  line("STEP 9 — assignment queue position");
  sep();

  const queue = await bookingPriorityService.getAssignmentQueue(50);
  const inQueue = queue.find((q) => q.bookingId === booking.id);
  line(`Queue size: ${queue.length}, this booking in queue: ${inQueue ? `position ${inQueue.position}` : "NOT IN QUEUE"}`);

  sep();
  line("STEP 10 — assignment_audits for this job");
  sep();

  if (job) {
    const audits = await prisma.assignmentAudit.findMany({
      where: { jobId: job.id },
      orderBy: { createdAt: "asc" },
    });
    for (const a of audits) {
      line(`  ${a.createdAt.toISOString()} action=${a.action} details=${a.details}`);
    }
    if (audits.length === 0) line("  (no audits)");
  }

  sep();
  line("STEP 11 — Force processQueue() now");
  sep();

  const result = await assignmentEngine.processQueue();
  line(`processQueue: processed=${result.processed} dispatched=${result.dispatched}`);

  const bookingAfter = await prisma.booking.findUnique({ where: { id: booking.id } });
  const jobAfter = await prisma.assignmentJob.findUnique({ where: { bookingId: booking.id } });
  const attemptAfter = jobAfter
    ? await prisma.assignmentAttempt.findFirst({
        where: { jobId: jobAfter.id },
        orderBy: { dispatchedAt: "desc" },
      })
    : null;

  line(`After dispatch:`);
  line(`  booking.provider_id = ${bookingAfter?.providerId ?? "NULL"}`);
  line(`  job.status          = ${jobAfter?.status ?? "N/A"}`);
  line(`  attempt             = ${attemptAfter ? `${attemptAfter.id} provider=${attemptAfter.providerId} status=${attemptAfter.status}` : "NONE"}`);

  sep();
  line("STEP 12 — Partner requests API simulation (providerService.myBookings pending)");
  sep();

  if (bookingAfter?.providerId) {
    const partnerBookings = await providerService.myBookings(bookingAfter.providerId, { status: "pending" });
    const found = partnerBookings.some((b) => b.id === booking.id);
    line(`Provider ${bookingAfter.providerId} pending list count=${partnerBookings.length}, contains booking=${found}`);
  } else {
    for (const p of allProviders.filter((x) => x.isOnline)) {
      const partnerBookings = await providerService.myBookings(p.id, { status: "pending" });
      line(`  Online provider ${p.id.slice(0, 12)}… pending count=${partnerBookings.length}`);
    }
  }

  sep();
  line("STEP 13 — Notifications (BOOKING_REQUEST)");
  sep();

  if (attemptAfter) {
    const prov = await prisma.provider.findUnique({
      where: { id: attemptAfter.providerId },
      select: { userId: true },
    });
    if (prov) {
      const notifs = await prisma.notification.findMany({
        where: { userId: prov.userId, type: "BOOKING_REQUEST", referenceId: booking.id },
        orderBy: { createdAt: "desc" },
        take: 3,
      });
      line(`BOOKING_REQUEST notifications for provider user: ${notifs.length}`);
      for (const n of notifs) {
        line(`  id=${n.id} created=${n.createdAt.toISOString()} read=${n.isRead}`);
      }
    }
  } else {
    line("No dispatch attempt — no notification expected");
  }

  await prisma.$disconnect();
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
