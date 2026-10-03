/**
 * Cross-system production lock certification.
 *
 * Closes remaining gates without rebuilding S01/S02/S03:
 * - Customer booking chat (canonical /api/bookings/:id/chat)
 * - Chat authz + idempotency
 * - Partner phone privacy (no raw phone in customer payloads)
 * - Controlled customer→partner dial
 * - Multi-role state convergence on one booking
 *
 * Usage: cd apps/backend && bun run scripts/cross-system-production-lock-cert.ts
 */
import "dotenv/config";
import { BookingStatus, PaymentStatus, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const RUN = `xsys-${Date.now().toString(36)}`;
let failed = 0;

const JOB_LAT = 12.97;
const JOB_LNG = 77.59;
const INSIDE = { lat: 12.9701, lng: 77.5901 };

function gate(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function customerUiBucket(
  status: string,
  enRouteAt?: Date | null,
  arrivedAt?: Date | null,
  startedAt?: Date | null,
) {
  const s = status.toUpperCase().replace(/-/g, "_");
  if (s === "COMPLETED") return "completed";
  if (s === "IN_PROGRESS" || startedAt) return "in_progress";
  if (s === "EN_ROUTE" || enRouteAt || arrivedAt) return "in_progress"; // Live
  if (s === "ACCEPTED" || s === "ASSIGNED") return "confirmed";
  if (s.includes("CANCEL")) return "cancelled";
  return "pending";
}

async function main() {
  const { bookingService } = await import("../src/services/booking.service");
  const { bookingChatService } = await import("../src/services/booking-chat.service");
  const { bookingContactService } = await import("../src/services/booking-contact.service");

  const customer = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION",
      firstName: "XSys",
      lastName: "Customer",
      phoneNumber: `+9199${String(Date.now()).slice(-8)}`,
      password: "test-hash",
      role: "CUSTOMER",
    },
  });
  const stranger = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION",
      firstName: "XSys",
      lastName: "Stranger",
      phoneNumber: `+9197${String(Date.now()).slice(-8)}`,
      password: "test-hash",
      role: "CUSTOMER",
    },
  });
  const providerUser = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION",
      firstName: "XSys",
      lastName: "Partner",
      phoneNumber: `+9198${String(Date.now()).slice(-8)}`,
      password: "test-hash",
      role: "VENDOR",
    },
  });
  const otherProviderUser = await prisma.user.create({
    data: { dataOrigin: "CERTIFICATION",
      firstName: "XSys",
      lastName: "OtherPartner",
      phoneNumber: `+9196${String(Date.now()).slice(-8)}`,
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
      addressLine1: "12 Cross Lane",
      city: "Bengaluru",
      state: "KA",
      zipCode: "560001",
      latitude: JOB_LAT,
      longitude: JOB_LNG,
      fullAddress: "12 Cross Lane, Bengaluru",
    },
  });

  const provider = await prisma.provider.create({
    data: {
      userId: providerUser.id,
      businessName: `XSys Biz ${RUN}`,
      isApproved: true,
      isVerified: true,
      isActive: true,
      isOnline: true,
    },
  });
  const otherProvider = await prisma.provider.create({
    data: {
      userId: otherProviderUser.id,
      businessName: `XSys Other ${RUN}`,
      isApproved: true,
      isVerified: true,
      isActive: true,
      isOnline: true,
    },
  });

  const booking = await prisma.booking.create({
    data: { dataOrigin: "CERTIFICATION",
      bookingNumber: `XSYS-${RUN}`,
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

  // ── Phone privacy ──────────────────────────────────────────────
  const forUser = await bookingService.getForUser(customer.id, booking.id);
  const detail = await bookingService.getById(booking.id, customer.id);

  gate(
    "privacy.customer_getForUser_no_raw_partner_phone",
    Boolean(forUser?.provider) && !("phoneNumber" in (forUser!.provider ?? {})),
    forUser?.provider ? `keys=${Object.keys(forUser.provider).join(",")}` : "missing",
  );
  gate(
    "privacy.customer_detail_no_raw_partner_phone",
    Boolean(detail?.provider) && !("phoneNumber" in (detail!.provider ?? {})),
  );
  gate(
    "privacy.customer_detail_has_phone_masked",
    typeof detail?.provider?.phoneMasked === "string" &&
      detail.provider.phoneMasked.length > 0 &&
      !detail.provider.phoneMasked.includes(providerUser.phoneNumber!.replace(/\D/g, "").slice(-6)),
    `masked=${detail?.provider?.phoneMasked ?? "null"}`,
  );

  const maskedContact = await bookingContactService.getPartnerMaskedContact(booking.id, customer.id);
  gate("privacy.partner_contact_masked", Boolean(maskedContact.phoneMasked) && maskedContact.canCall === true);

  let strangerContactFailed = false;
  try {
    await bookingContactService.getPartnerMaskedContact(booking.id, stranger.id);
  } catch {
    strangerContactFailed = true;
  }
  gate("privacy.stranger_cannot_read_partner_contact", strangerContactFailed);

  const dial = await bookingContactService.initiatePartnerCall(booking.id, customer.id);
  gate(
    "privacy.controlled_dial_uri",
    typeof dial.dialUri === "string" && dial.dialUri.startsWith("tel:") && Boolean(dial.phoneMasked),
  );

  // ── Chat: same conversation + idempotency + authz ──────────────
  const clientId = `xsys-idem-${RUN}`;
  const send1 = await bookingChatService.sendMessage(
    booking.id,
    customer.id,
    "Hello from customer web",
    clientId,
  );
  const send2 = await bookingChatService.sendMessage(
    booking.id,
    customer.id,
    "Hello from customer web",
    clientId,
  );
  gate(
    "chat.idempotent_double_send",
    send1.created === true && send2.created === false && send1.message.id === send2.message.id,
  );

  const partnerSend = await bookingChatService.sendMessage(
    booking.id,
    providerUser.id,
    "Partner mobile reply",
    `partner-${RUN}`,
  );
  gate("chat.partner_can_reply", partnerSend.created === true);

  const customerList = await bookingChatService.listMessages(booking.id, { userId: customer.id });
  const partnerList = await bookingChatService.listMessages(booking.id, {
    userId: providerUser.id,
    providerId: provider.id,
  });
  gate(
    "chat.same_conversation",
    customerList.conversationId === partnerList.conversationId &&
      customerList.messages.length === partnerList.messages.length &&
      customerList.messages.length >= 2,
    `conv=${customerList.conversationId} n=${customerList.messages.length}`,
  );

  let strangerChatFail = false;
  try {
    await bookingChatService.listMessages(booking.id, { userId: stranger.id });
  } catch (e) {
    strangerChatFail = e instanceof Error && e.message === "FORBIDDEN";
  }
  gate("chat.customer_a_cannot_read_booking_b", strangerChatFail);

  let strangerSendFail = false;
  try {
    await bookingChatService.sendMessage(booking.id, stranger.id, "leak attempt");
  } catch (e) {
    strangerSendFail = e instanceof Error && e.message === "FORBIDDEN";
  }
  gate("chat.customer_a_cannot_write_booking_b", strangerSendFail);

  let otherPartnerFail = false;
  try {
    await bookingChatService.listMessages(booking.id, {
      userId: otherProviderUser.id,
      providerId: otherProvider.id,
    });
  } catch (e) {
    otherPartnerFail = e instanceof Error && e.message === "FORBIDDEN";
  }
  gate("chat.partner_a_cannot_read_booking_b", otherPartnerFail);

  // ── Multi-client state convergence (canonical backend) ─────────
  const assertConverge = async (
    label: string,
    expectedStatus: BookingStatus,
    expectedBucket: string,
  ) => {
    const db = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const custDetail = await bookingService.getById(booking.id, customer.id);
    const bucket = customerUiBucket(
      String(custDetail!.status),
      db.enRouteAt,
      db.arrivedAt,
      db.startedAt,
    );
    gate(`state.${label}.db`, db.status === expectedStatus, `db=${db.status}`);
    gate(
      `state.${label}.customer_ui_bucket`,
      bucket === expectedBucket,
      `bucket=${bucket} api=${custDetail!.status}`,
    );
    gate(
      `state.${label}.partner_assignment`,
      db.providerId === provider.id && db.userId === customer.id,
    );
  };

  const en = await bookingService.markEnRoute(provider.id, booking.id, 0, 0);
  gate("lifecycle.en_route", en.ok === true);
  await assertConverge("en_route", BookingStatus.EN_ROUTE, "in_progress");

  const near = await bookingService.markArrived(provider.id, booking.id, INSIDE.lat, INSIDE.lng);
  gate("lifecycle.arrived", near.ok === true);
  {
    const db = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    gate("state.arrived.timestamp", Boolean(db.arrivedAt));
    const bucket = customerUiBucket(db.status, db.enRouteAt, db.arrivedAt, db.startedAt);
    gate("state.arrived.customer_ui_bucket", bucket === "in_progress", `bucket=${bucket}`);
  }

  const started = await bookingService.start(provider.id, booking.id, INSIDE.lat, INSIDE.lng);
  gate(
    "lifecycle.start",
    String(started.status).toUpperCase() === "IN_PROGRESS" && started.startedAt != null,
  );
  await assertConverge("in_progress", BookingStatus.IN_PROGRESS, "in_progress");

  const completed = await bookingService.complete(
    provider.id,
    booking.id,
    INSIDE.lat,
    INSIDE.lng,
    "xsys complete",
  );
  gate(
    "lifecycle.complete",
    completed.newlyCompleted === true &&
      String(completed.booking.status).toUpperCase() === "COMPLETED",
  );
  await assertConverge("completed", BookingStatus.COMPLETED, "completed");

  const earnings = await prisma.earning.count({ where: { bookingId: booking.id } });
  gate("db.single_earning", earnings === 1, `count=${earnings}`);

  const conv = await prisma.bookingConversation.findUnique({ where: { bookingId: booking.id } });
  const msgCount = conv
    ? await prisma.bookingMessage.count({ where: { conversationId: conv.id } })
    : 0;
  gate("db.conversation_bound", Boolean(conv) && msgCount >= 2, `messages=${msgCount}`);

  const chatEvents = await prisma.activityLog.count({
    where: { bookingId: booking.id, action: "BOOKING_CHAT_MESSAGE" },
  });
  gate("events.chat_logged", chatEvents >= 2, `n=${chatEvents}`);

  const callEvents = await prisma.activityLog.count({
    where: { bookingId: booking.id, action: "PARTNER_CALL_INITIATED" },
  });
  gate("events.partner_call_logged", callEvents >= 1, `n=${callEvents}`);

  console.log("\n────────────────────────────────────────");
  if (failed === 0) {
    console.log("RESULT: CROSS-SYSTEM PRODUCTION LOCK CERT — FULL PASS");
    process.exit(0);
  } else {
    console.error(`RESULT: FAIL — ${failed} gate(s)`);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
