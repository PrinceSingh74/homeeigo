/**
 * E2E: demo customer books plumbing → partner@homigo.demo sees request instantly.
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";
import { providerService } from "../src/services/provider.service";
import { userPiiService } from "../src/services/user-pii.service";

const customer = await userPiiService.findByEmail("customer@homigo.demo");
const partner = await userPiiService.findByEmail("partner@homigo.demo");
if (!customer || !partner) throw new Error("Demo users missing — run ensure:demo-users");

const provider = await prisma.provider.findUnique({ where: { userId: partner.id } });
const addr = await prisma.address.findFirst({ where: { userId: customer.id } });
const service = await prisma.service.findFirst({ where: { slug: "plumbing", isActive: true } });
if (!provider || !addr || !service) throw new Error("Missing provider/address/service");

const created = await bookingService.create(customer.id, {
  serviceId: service.id,
  scheduledDate: new Date(Date.now() + (5 + Math.floor(Math.random() * 10)) * 86400_000).toISOString(),
  addressId: addr.id,
});
if ("error" in created) throw new Error(`Create failed: ${created.error}`);

const b = await prisma.booking.findUnique({ where: { id: created.booking.id } });
const job = await prisma.assignmentJob.findUnique({ where: { bookingId: created.booking.id } });
const attempt = job
  ? await prisma.assignmentAttempt.findFirst({ where: { jobId: job.id } })
  : null;
const assignedId = b?.providerId;
const assignedProvider = assignedId
  ? await prisma.provider.findUnique({ where: { id: assignedId } })
  : null;
const pending = assignedId
  ? await providerService.myBookings(assignedId, { status: "pending" })
  : null;
const partnerSees = pending?.bookings.some((x) => x.id === created.booking.id) ?? false;
const demoPartnerGotIt = assignedId === provider.id;

const demoPending = await providerService.myBookings(provider.id, { status: "pending" });
const demoSees = demoPending.bookings.some((x) => x.id === created.booking.id);

console.log(
  JSON.stringify(
    {
      bookingId: created.booking.id,
      providerId: b?.providerId,
      jobStatus: job?.status,
      demoPartnerGotIt: assignedId === provider.id,
      demoSees,
      partnerSees,
    },
    null,
    2,
  ),
);
const pass = Boolean(b?.providerId && partnerSees && demoSees);
console.log(pass ? "\n✅ PASS" : "\n❌ FAIL");
await prisma.$disconnect();
process.exit(pass ? 0 : 1);
