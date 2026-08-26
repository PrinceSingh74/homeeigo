/**
 * Whole-project integration certification.
 *
 * Drives the canonical services (no second engines):
 * booking.create → payment.verify → matching → dispatch → accept →
 * chat → en_route → arrive → start OTP → start → evidence → complete →
 * earning/wallet → withdrawal → rating → security → events.
 *
 * Usage: cd apps/backend && bun run scripts/whole-project-integration-cert.ts
 */
import "dotenv/config";
import { BookingStatus, PaymentStatus, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const RUN = `wpic-${Date.now().toString(36)}`;
let failed = 0;
const warnings: string[] = [];

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

function warn(name: string, detail: string) {
  warnings.push(`${name}: ${detail}`);
  console.log(`WARN  ${name} — ${detail}`);
}

async function main() {
  const { bookingService } = await import("../src/services/booking.service");
  const { paymentService } = await import("../src/services/payment.service");
  const { razorpayService } = await import("../src/services/razorpay.service");
  const { matchingService } = await import("../src/services/matching.service");
  const { assignmentEngine } = await import("../src/services/assignment-engine.service");
  const { partnerOperationsService } = await import("../src/services/partner-operations.service");
  const { bookingChatService } = await import("../src/services/booking-chat.service");
  const { jobEvidenceService } = await import("../src/services/job-evidence.service");
  const { bookingStartOtpService } = await import("../src/services/booking-start-otp.service");
  const { bookingContactService } = await import("../src/services/booking-contact.service");
  const { earningsService } = await import("../src/services/earnings.service");
  const { providerWalletReservationService } = await import(
    "../src/services/provider-wallet-reservation.service"
  );
  const { ratingService } = await import("../src/services/rating.service");
  const { adminBookingOperationsService } = await import(
    "../src/services/admin-booking-operations.service"
  );
  const { EVENT_TYPES } = await import("../src/events/catalog/event-types");
  const { eventPlatformConfig } = await import("../src/events/core/config");

  const service = await prisma.service.findFirst({ where: { isActive: true } });
  if (!service) throw new Error("No active service");

  const customer = await prisma.user.create({
    data: {
      firstName: "Wpic",
      lastName: "Customer",
      phoneNumber: `+9199${String(Date.now()).slice(-8)}`,
      password: "test-hash",
      role: "CUSTOMER",
    },
  });
  const stranger = await prisma.user.create({
    data: {
      firstName: "Wpic",
      lastName: "Stranger",
      phoneNumber: `+9197${String(Date.now()).slice(-8)}`,
      password: "test-hash",
      role: "CUSTOMER",
    },
  });
  const providerUser = await prisma.user.create({
    data: {
      firstName: "Wpic",
      lastName: "Partner",
      phoneNumber: `+9198${String(Date.now()).slice(-8)}`,
      password: "test-hash",
      role: "VENDOR",
    },
  });
  const otherProviderUser = await prisma.user.create({
    data: {
      firstName: "Wpic",
      lastName: "Other",
      phoneNumber: `+9196${String(Date.now()).slice(-8)}`,
      password: "test-hash",
      role: "VENDOR",
    },
  });

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
      businessName: `Wpic Biz ${RUN}`,
      isApproved: true,
      isVerified: true,
      isActive: true,
      isOnline: true,
      serviceCategories: [service.category, service.slug, "cleaning"],
      serviceRadiusKm: 25,
      baseLatitude: JOB_LAT,
      baseLongitude: JOB_LNG,
      maxConcurrentJobs: 4,
    },
  });
  await prisma.location.create({
    data: { providerId: provider.id, latitude: JOB_LAT, longitude: JOB_LNG },
  });
  await prisma.provider.updateMany({
    where: {
      businessName: { startsWith: "Wpic Biz " },
      id: { not: provider.id },
    },
    data: { isOnline: false, pausedAt: new Date() },
  });
  const otherProvider = await prisma.provider.create({
    data: {
      userId: otherProviderUser.id,
      businessName: `Wpic Other ${RUN}`,
      isApproved: true,
      isVerified: true,
      isActive: true,
      isOnline: true,
    },
  });

  try {
    await partnerOperationsService.setOnline(provider.id, true);
  } catch (err) {
    warn(
      "availability.set_online",
      err instanceof Error ? err.message : String(err),
    );
  }

  const created = await bookingService.create(customer.id, {
    serviceId: service.id,
    scheduledDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    addressId: address.id,
    paymentMethod: "razorpay",
  });
  gate("booking.create", !("error" in created) && Boolean(created.booking?.id));
  if ("error" in created || !created.booking) {
    throw new Error(`booking.create failed: ${"error" in created ? created.error : "no booking"}`);
  }
  const bookingId = created.booking.id;
  gate("booking.initial_pending", created.booking.status === "pending", created.booking.status);

  const createdEvent = await prisma.eventOutbox.findFirst({
    where: { eventType: EVENT_TYPES.BOOKING_CREATED, aggregateId: bookingId },
  });
  if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
    gate("events.booking_created", Boolean(createdEvent), createdEvent?.status ?? "missing");
  } else {
    warn("events.booking_created", "outbox or booking events disabled");
  }

  const order = await paymentService.createOrder(customer.id, bookingId);
  const orderId = order && "razorpayOrderId" in order ? order.razorpayOrderId : null;
  gate("payment.create_order", Boolean(orderId), orderId ?? "none");
  if (!orderId) {
    throw new Error("payment.create_order failed");
  }
  const sandbox = String(orderId).startsWith("order_dev_") || String(orderId).startsWith("pending:");
  if (sandbox) warn("payment.sandbox", "Local/dev Razorpay HMAC verify path");
  else warn("payment.sandbox", "Razorpay gateway order — not live payout cert");

  const rzpPaymentId = `pay_wpic_${RUN}`;
  const signature = razorpayService.computePaymentSignature(orderId, rzpPaymentId);
  const verified = await paymentService.verify(customer.id, {
    razorpayOrderId: orderId,
    razorpayPaymentId: rzpPaymentId,
    razorpaySignature: signature,
  });
  gate(
    "payment.verify",
    !("error" in verified) && (verified as { status?: string }).status === "success",
    "error" in verified ? String((verified as { error: string }).error) : "ok",
  );

  const paid = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { paymentStatus: true, status: true },
  });
  gate("payment.booking_success", paid?.paymentStatus === PaymentStatus.SUCCESS);

  const payEvent = await prisma.eventOutbox.findFirst({
    where: { eventType: EVENT_TYPES.PAYMENT_SUCCESS },
    orderBy: { createdAt: "desc" },
  });
  if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.paymentEventsEnabled) {
    gate("events.payment_success", Boolean(payEvent), payEvent?.status ?? "missing");
  } else {
    warn("events.payment_success", "outbox or payment events disabled");
  }

  const matches = await matchingService.findBestProviders({
    serviceId: service.id,
    customerId: customer.id,
    latitude: JOB_LAT,
    longitude: JOB_LNG,
    scheduledDate: new Date(),
  });
  gate(
    "matching.includes_partner",
    matches.some((m) => m.providerId === provider.id),
    `candidates=${matches.length}`,
  );

  const existingAttempts = await prisma.assignmentAttempt.findMany({
    where: { job: { bookingId } },
    orderBy: { dispatchedAt: "desc" },
  });
  const dispatchedNow = existingAttempts.length ? false : await assignmentEngine.dispatchBookingNow(bookingId);
  const attempts =
    existingAttempts.length > 0
      ? existingAttempts
      : await prisma.assignmentAttempt.findMany({
          where: { job: { bookingId } },
          orderBy: { dispatchedAt: "desc" },
        });
  gate(
    "dispatch.offer",
    attempts.length > 0 && (dispatchedNow === true || existingAttempts.length > 0),
    existingAttempts.length ? `inline on create n=${attempts.length}` : `dispatchNow=${dispatchedNow}`,
  );
  gate(
    "dispatch.attempt_our_partner",
    attempts.some((a) => a.providerId === provider.id),
    attempts.map((a) => a.providerId).join(",") || "none",
  );

  const accepted = await bookingService.accept(provider.id, bookingId);
  gate("job.accept", accepted.ok === true && accepted.ok && accepted.booking.status === BookingStatus.ACCEPTED);

  const customerView = await bookingService.getById(bookingId, customer.id);
  const partnerView = await bookingService.getById(bookingId, undefined, provider.id);
  const dbRow = await prisma.booking.findUnique({ where: { id: bookingId } });
  const customerStatus = customerView?.status;
  const partnerStatus = partnerView?.status;
  const adminStatus = dbRow?.status.toLowerCase();
  gate(
    "consistency.status_accepted",
    customerStatus === partnerStatus && partnerStatus === adminStatus && adminStatus === "accepted",
    `c=${customerStatus} p=${partnerStatus} a=${adminStatus}`,
  );
  gate(
    "privacy.customer_no_raw_phone",
    Boolean(customerView?.provider) && !("phoneNumber" in (customerView!.provider ?? {})),
  );
  const customerBlob = JSON.stringify(customerView);
  gate(
    "privacy.customer_no_partner_finance",
    !/walletBalance|ifsc|bankAccount|payout|incentive/i.test(customerBlob),
  );

  const contact = await bookingContactService.getPartnerMaskedContact(bookingId, customer.id);
  gate("call.masked", Boolean(contact.phoneMasked) && !/^\+?\d{10,}$/.test(contact.phoneMasked ?? ""));

  const hello = await bookingChatService.sendMessage(bookingId, customer.id, "Hello", `hello-${RUN}`);
  const helloDup = await bookingChatService.sendMessage(bookingId, customer.id, "Hello", `hello-${RUN}`);
  gate("chat.customer_send", hello.created === true);
  gate("chat.idempotent", helloDup.created === false && helloDup.message.id === hello.message.id);

  const partnerList = await bookingChatService.listMessages(bookingId, { userId: providerUser.id });
  gate(
    "chat.same_conversation",
    partnerList.messages.some((m) => m.id === hello.message.id && m.body === "Hello"),
  );
  const reply = await bookingChatService.sendMessage(bookingId, providerUser.id, "On my way");
  const customerList = await bookingChatService.listMessages(bookingId, { userId: customer.id });
  gate(
    "chat.partner_reply_visible",
    customerList.messages.some((m) => m.id === reply.message.id),
  );
  let chatStrangerDenied = false;
  try {
    await bookingChatService.sendMessage(bookingId, stranger.id, "peek");
  } catch (e) {
    chatStrangerDenied = e instanceof Error && /FORBIDDEN/.test(e.message);
  }
  gate("security.chat_stranger", chatStrangerDenied);

  const en = await bookingService.markEnRoute(provider.id, bookingId, INSIDE.lat, INSIDE.lng);
  gate("job.en_route", en.ok === true && en.ok && en.newlyTransitioned === true);
  const afterEn = await prisma.booking.findUnique({ where: { id: bookingId } });
  const custEn = await bookingService.getById(bookingId, customer.id);
  gate(
    "consistency.status_en_route",
    afterEn?.status === BookingStatus.EN_ROUTE && custEn?.status === "en_route",
  );

  const arrived = await bookingService.markArrived(provider.id, bookingId, INSIDE.lat, INSIDE.lng);
  gate("job.arrive", arrived.ok === true && arrived.ok && arrived.newlyTransitioned === true);

  const issued = await bookingStartOtpService.issue(provider.id, bookingId);
  gate("otp.issue", issued.ok === true);
  const pinView = await bookingStartOtpService.customerView(customer.id, bookingId);
  gate("otp.customer_pin", pinView.ok === true && pinView.ok && pinView.state === "active" && Boolean(pinView.pin));
  const otpGate = await bookingStartOtpService.ensureCanStart(
    provider.id,
    bookingId,
    pinView.ok ? pinView.pin ?? undefined : undefined,
  );
  gate("otp.verify", otpGate.ok === true);

  const started = await bookingService.start(provider.id, bookingId, INSIDE.lat, INSIDE.lng);
  gate("job.start", started.status === BookingStatus.IN_PROGRESS);
  const custStart = await bookingService.getById(bookingId, customer.id);
  gate("consistency.status_in_progress", custStart?.status === "in_progress");

  const ev = await jobEvidenceService.recordStage({
    bookingId,
    providerId: provider.id,
    stage: "COMPLETION",
    latitude: INSIDE.lat,
    longitude: INSIDE.lng,
    clientUploadId: `wpic-${RUN}`,
  });
  const evDup = await jobEvidenceService.recordStage({
    bookingId,
    providerId: provider.id,
    stage: "COMPLETION",
    latitude: INSIDE.lat,
    longitude: INSIDE.lng,
    clientUploadId: `wpic-${RUN}`,
  });
  gate("evidence.single", ev.id === evDup.id);
  gate("evidence.no_public_url_required", !ev.mediaUrl || ev.mediaUrl.length === 0 || Boolean(ev.mediaStorageKey));

  const walletBefore = await prisma.provider.findUnique({
    where: { id: provider.id },
    select: { walletBalance: true },
  });
  const firstComplete = await bookingService.complete(
    provider.id,
    bookingId,
    INSIDE.lat,
    INSIDE.lng,
    "done",
  );
  const secondComplete = await bookingService.complete(
    provider.id,
    bookingId,
    INSIDE.lat,
    INSIDE.lng,
    "retry",
  );
  gate("job.complete", firstComplete.newlyCompleted === true && firstComplete.booking.status === "COMPLETED");
  gate("job.complete_idempotent", secondComplete.newlyCompleted === false);
  const earnings = await prisma.earning.findMany({ where: { bookingId } });
  gate("finance.single_earning", earnings.length === 1, `count=${earnings.length}`);

  const walletAfter = await prisma.provider.findUnique({
    where: { id: provider.id },
    select: { walletBalance: true },
  });
  gate(
    "finance.wallet_credited",
    (walletAfter?.walletBalance ?? 0) > (walletBefore?.walletBalance ?? 0),
    `${walletBefore?.walletBalance} → ${walletAfter?.walletBalance}`,
  );

  const partnerFinance = await earningsService.getPartnerFinanceCenter(provider.id);
  gate(
    "finance.center_matches_wallet",
    Math.abs(partnerFinance.currentBalance - (walletAfter?.walletBalance ?? 0)) < 0.02,
  );

  const completedEvent = await prisma.eventOutbox.findFirst({
    where: { eventType: EVENT_TYPES.BOOKING_COMPLETED, aggregateId: bookingId },
  });
  if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
    gate("events.booking_completed", Boolean(completedEvent));
  } else {
    warn("events.booking_completed", "outbox or booking events disabled");
  }

  const custDone = await bookingService.getById(bookingId, customer.id);
  const partnerDone = await bookingService.getById(bookingId, undefined, provider.id);
  const adminDone = await prisma.booking.findUnique({ where: { id: bookingId } });
  gate(
    "consistency.status_completed",
    custDone?.status === "completed" &&
      partnerDone?.status === "completed" &&
      adminDone?.status === BookingStatus.COMPLETED,
  );

  const withdrawAmt = Math.min(50, Math.floor((walletAfter?.walletBalance ?? 0) * 0.5) || 0);
  if (withdrawAmt >= 1) {
    const wdBody = {
      amount: withdrawAmt,
      bankAccountNumber: "123456789012",
      ifscCode: "HDFC0001234",
      accountHolder: "Wpic Partner",
      idempotencyKey: `wd-${RUN}`,
    };
    const wd1 = await providerWalletReservationService.reserveAndCreateWithdrawal(provider.id, wdBody);
    const wd2 = await providerWalletReservationService.reserveAndCreateWithdrawal(provider.id, wdBody);
    gate("withdraw.created", "withdrawal" in wd1);
    gate(
      "withdraw.idempotent",
      "withdrawal" in wd1 && "withdrawal" in wd2 && wd1.withdrawal.id === wd2.withdrawal.id,
    );
    const wdCount = await prisma.withdrawal.count({ where: { providerId: provider.id } });
    gate("withdraw.single_row", wdCount === 1, `count=${wdCount}`);
  } else {
    warn("withdraw.skipped", "wallet too small after this job");
  }

  const rated = await ratingService.create(customer.id, {
    bookingId,
    rating: 5,
    reviewText: "Great service",
  });
  gate("review.create", !("error" in rated));

  const strangerView = await bookingService.getById(bookingId, stranger.id);
  gate("security.customer_isolation", strangerView === null);

  let otherCompleteDenied = false;
  try {
    await bookingService.complete(otherProvider.id, bookingId, INSIDE.lat, INSIDE.lng);
  } catch (e) {
    otherCompleteDenied = e instanceof Error && /FORBIDDEN|INVALID/.test(e.message);
  }
  gate("security.partner_isolation", otherCompleteDenied);

  const unmatched = await prisma.booking.create({
    data: {
      bookingNumber: `WPIC-U-${RUN}`,
      userId: customer.id,
      serviceId: service.id,
      addressId: address.id,
      status: BookingStatus.PENDING,
      paymentStatus: PaymentStatus.PENDING,
      scheduledDate: new Date(),
      baseAmount: 199,
      finalAmount: 199,
      totalAmount: 199,
    },
  });
  let adminNoProvider = false;
  try {
    await adminBookingOperationsService.markComplete(unmatched.id, customer.id, "force close unmatched");
  } catch (e) {
    adminNoProvider = e instanceof Error && e.message === "NO_ASSIGNED_PROVIDER";
  }
  gate("integrity.admin_complete_requires_provider", adminNoProvider);

  const customerNotifs = await prisma.notification.findMany({
    where: { userId: customer.id },
    select: { type: true, title: true, message: true, body: true },
  });
  const notifBlob = JSON.stringify(customerNotifs);
  gate(
    "notifications.customer_no_partner_finance",
    !/ifsc|bank account|withdrawal requested|incentive paid/i.test(notifBlob),
  );

  console.log(
    failed === 0
      ? `\nWHOLE-PROJECT INTEGRATION CERT: FULL PASS${warnings.length ? ` (${warnings.length} WARN)` : ""}`
      : `\nWHOLE-PROJECT INTEGRATION CERT: ${failed} FAIL(S)`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
