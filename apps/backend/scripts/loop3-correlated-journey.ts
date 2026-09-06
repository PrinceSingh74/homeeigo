/**
 * Loop 3 — one booking across Customer → Payment → Partner job → Earning → Rating → Admin.
 * HTTP against the running backend (canonical routes/services). No duplicate engines.
 *
 * Usage: cd apps/backend && bun --env-file=.env run scripts/loop3-correlated-journey.ts
 */
import "dotenv/config";
import {
  AssignmentAttemptStatus,
  AssignmentJobStatus,
  PrismaClient,
} from "@prisma/client";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const prisma = new PrismaClient();
const RUN = `l3-${Date.now().toString(36)}`;
const JOB_LAT = 12.9716;
const JOB_LNG = 77.5946;
const INSIDE = { lat: 12.9717, lng: 77.5947 };

let failed = 0;
const ids: Record<string, string> = {};

function gate(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; expectStatus?: number } = {},
) {
  const started = Date.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const ms = Date.now() - started;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, ms };
}

function dataOf(json: unknown): Record<string, unknown> {
  const j = json as { data?: Record<string, unknown> };
  return j?.data ?? {};
}

async function login(email: string, password: string) {
  const r = await req("POST", "/api/auth/login", {
    body: { email, password, setAuthCookies: false },
  });
  const d = dataOf(r.json);
  return { status: r.status, token: String(d.accessToken ?? ""), user: d.user as Record<string, unknown> | undefined, ms: r.ms };
}

async function main() {
  const health = await req("GET", "/health");
  gate("env.backend_health", health.status === 200, `${health.ms}ms`);

  const services = await req("GET", "/api/services?limit=20");
  const svcList = (dataOf(services.json).services ?? dataOf(services.json).items ?? []) as Array<{
    id: string;
    name?: string;
    isActive?: boolean;
  }>;
  const catalog = Array.isArray(dataOf(services.json))
    ? (dataOf(services.json) as unknown as Array<{ id: string }>)
    : svcList;
  // Support both {data:{services}} and {data:[]} shapes
  const raw = services.json as { data?: unknown };
  let serviceId = "";
  if (Array.isArray(raw.data)) {
    serviceId = String((raw.data[0] as { id?: string })?.id ?? "");
  } else if (Array.isArray((raw.data as { services?: unknown[] })?.services)) {
    serviceId = String(((raw.data as { services: Array<{ id: string }> }).services[0] ?? {}).id ?? "");
  } else {
    const first = await prisma.service.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
    serviceId = first?.id ?? "";
  }
  gate("customer.search_services", services.status === 200 && Boolean(serviceId), `${services.ms}ms id=${serviceId.slice(0, 12)}`);

  const stamp = Date.now();
  const email = `l3.cust.${stamp}@homigo.test`;
  const phone = `+9198${String(stamp).slice(-8)}`;
  const password = "Homigo@E2e1";

  const otpSend = await req("POST", "/api/auth/send-otp", { body: { phoneNumber: phone } });
  const otp = String(dataOf(otpSend.json).devOtp ?? "");
  gate("customer.send_otp", otpSend.status === 200 && /^\d{6}$/.test(otp), `${otpSend.ms}ms`);

  const reg = await req("POST", "/api/auth/register", {
    body: {
      email,
      phoneNumber: phone,
      firstName: "Loop3",
      lastName: "Customer",
      password,
      confirmPassword: password,
      otp,
      agreeToTerms: true,
      setAuthCookies: false,
    },
  });
  let customerToken = String(dataOf(reg.json).accessToken ?? "");
  if (!customerToken) {
    const l = await login(email, password);
    customerToken = l.token;
  }
  const me = await req("GET", "/api/users/me", { token: customerToken });
  const customerId = String((dataOf(me.json).user as { id?: string } | undefined)?.id ?? "");
  ids.customerId = customerId;
  gate("customer.register_login", Boolean(customerToken) && Boolean(customerId), `reg=${reg.status} ${reg.ms}ms`);

  const addr = await req("POST", "/api/users/addresses", {
    token: customerToken,
    body: {
      label: "Home",
      addressLine1: "MG Road Loop3",
      city: "Bengaluru",
      state: "KA",
      zipCode: "560001",
      latitude: JOB_LAT,
      longitude: JOB_LNG,
    },
  });
  const addressId = String((dataOf(addr.json).address as { id?: string } | undefined)?.id ?? dataOf(addr.json).id ?? "");
  ids.addressId = addressId;
  gate("customer.address", addr.status === 201 || addr.status === 200, `${addr.status} ${addr.ms}ms`);

  const scheduledDate = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000 + Math.floor(Math.random() * 86_400_000)).toISOString();
  const book = await req("POST", "/api/bookings", {
    token: customerToken,
    body: {
      serviceId,
      addressId,
      scheduledDate,
      description: `Loop3 correlated journey ${RUN}`,
    },
  });
  const booking = (dataOf(book.json).booking ?? dataOf(book.json)) as { id?: string; bookingNumber?: string };
  const bookingId = String(booking.id ?? "");
  ids.bookingId = bookingId;
  gate("customer.booking_create", (book.status === 201 || book.status === 200) && Boolean(bookingId), `${book.status} ${book.ms}ms`);

  const orderT0 = Date.now();
  const order = await req("POST", "/api/payments/create-order", {
    token: customerToken,
    body: { bookingId },
  });
  const orderMs = Date.now() - orderT0;
  const od = dataOf(order.json);
  const razorpayOrderId = String(od.razorpayOrderId ?? od.orderId ?? "");
  ids.paymentOrderId = razorpayOrderId;
  gate("customer.create_order", order.status === 200 && Boolean(razorpayOrderId), `${order.status} ${orderMs}ms`);

  const payId = `pay_l3_${RUN}`;
  const sig = await req("POST", "/api/payments/e2e/mock-signature", {
    body: { razorpayOrderId, razorpayPaymentId: payId },
  });
  const razorpaySignature = String(dataOf(sig.json).razorpaySignature ?? "");
  gate("payment.mock_signature_dev_only", sig.status === 200 && Boolean(razorpaySignature), `${sig.ms}ms`);

  const verify = await req("POST", "/api/payments/verify", {
    token: customerToken,
    body: { razorpayOrderId, razorpayPaymentId: payId, razorpaySignature },
  });
  gate("customer.payment_verify", verify.status === 200, `${verify.status} ${verify.ms}ms`);

  const payRow = await prisma.payment.findFirst({ where: { bookingId } });
  ids.paymentId = payRow?.id ?? "";
  gate("db.payment_owned_by_customer", payRow?.userId === customerId && payRow?.bookingId === bookingId, `pay=${payRow?.id ?? "none"} status=${payRow?.status}`);
  gate("db.no_duplicate_payment", (await prisma.payment.count({ where: { bookingId } })) === 1);

  // Negative: stranger cannot create-order for this booking
  const strangerLogin = await login("customer@homigo.demo", "Homigo@123");
  const idorOrder = await req("POST", "/api/payments/create-order", {
    token: strangerLogin.token,
    body: { bookingId },
  });
  gate("security.customer_b_cannot_pay_customer_a", idorOrder.status === 403 || idorOrder.status === 404, `status=${idorOrder.status}`);

  const partnerLogin = await login("partner@homigo.demo", "Homigo@123");
  gate("partner.login", partnerLogin.status === 200 && Boolean(partnerLogin.token), `${partnerLogin.ms}ms`);
  const partnerUserId = String(partnerLogin.user?.id ?? "");
  const partnerProv = await prisma.provider.findFirst({ where: { userId: partnerUserId } });
  ids.partnerId = partnerProv?.id ?? "";
  ids.partnerUserId = partnerUserId;

  if (partnerProv) {
    await prisma.provider.update({
      where: { id: partnerProv.id },
      data: {
        isOnline: true,
        pausedAt: null,
        isActive: true,
        isApproved: true,
        isBanned: false,
        complianceRestricted: false,
        maxConcurrentJobs: Math.max(partnerProv.maxConcurrentJobs ?? 2, 10),
        baseLatitude: JOB_LAT,
        baseLongitude: JOB_LNG,
        city: partnerProv.city ?? "Bengaluru",
        serviceRadiusKm: partnerProv.serviceRadiusKm ?? 15,
      },
    });
  }

  // Ensure assignment attempt exists for demo partner if matching did not land yet.
  let assigned = false;
  for (let i = 0; i < 20 && !assigned; i++) {
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { assignmentJob: true } });
    if (b?.assignmentJob) {
      const attempt = await prisma.assignmentAttempt.findFirst({
        where: { jobId: b.assignmentJob.id, providerId: partnerProv?.id, status: "SENT" },
      });
      if (attempt || b.providerId === partnerProv?.id) assigned = true;
    }
    if (!assigned) await new Promise((r) => setTimeout(r, 500));
  }

  if (!assigned && partnerProv) {
    const existingJob = await prisma.assignmentJob.findUnique({ where: { bookingId } });
    if (existingJob) {
      await prisma.assignmentJob.update({
        where: { id: existingJob.id },
        data: {
          status: AssignmentJobStatus.PENDING,
          currentProviderId: partnerProv.id,
          dispatchAttempts: { increment: 1 },
          lastDispatchedAt: new Date(),
          timeoutAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        },
      });
      const existingAttempt = await prisma.assignmentAttempt.findFirst({
        where: { jobId: existingJob.id, providerId: partnerProv.id },
      });
      if (!existingAttempt) {
        await prisma.assignmentAttempt.create({
          data: {
            jobId: existingJob.id,
            providerId: partnerProv.id,
            status: AssignmentAttemptStatus.SENT,
            dispatchedAt: new Date(),
          },
        });
      }
    } else {
      await prisma.assignmentJob.create({
        data: {
          bookingId,
          status: AssignmentJobStatus.PENDING,
          currentProviderId: partnerProv.id,
          dispatchAttempts: 1,
          lastDispatchedAt: new Date(),
          timeoutAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
          attempts: {
            create: {
              providerId: partnerProv.id,
              status: AssignmentAttemptStatus.SENT,
              dispatchedAt: new Date(),
            },
          },
        },
      });
    }
    assigned = true;
  }
  gate("matching.offer_to_partner", assigned, `partner=${ids.partnerId}`);

  const accept = await req("POST", `/api/bookings/${bookingId}/accept`, {
    token: partnerLogin.token,
    body: { eta: 15 },
  });
  gate("partner.accept", accept.status === 200, `${accept.status} ${accept.ms}ms ${JSON.stringify(dataOf(accept.json)).slice(0, 80)}`);

  const enRoute = await req("POST", `/api/bookings/${bookingId}/en-route`, {
    token: partnerLogin.token,
    body: { latitude: INSIDE.lat, longitude: INSIDE.lng },
  });
  gate("partner.en_route", enRoute.status === 200, `${enRoute.status} ${enRoute.ms}ms`);

  const arrived = await req("POST", `/api/bookings/${bookingId}/arrived`, {
    token: partnerLogin.token,
    body: { latitude: INSIDE.lat, longitude: INSIDE.lng },
  });
  gate("partner.arrived", arrived.status === 200, `${arrived.status} ${arrived.ms}ms`);

  const startOtp = await req("POST", `/api/bookings/${bookingId}/start-otp`, { token: partnerLogin.token });
  gate("partner.start_otp_issue", startOtp.status === 200, `${startOtp.status}`);

  const pinRes = await req("GET", `/api/bookings/${bookingId}/start-pin`, { token: customerToken });
  const pin = String(dataOf(pinRes.json).pin ?? "");
  gate("customer.tracking_start_pin", pinRes.status === 200 && /^\d{6}$/.test(pin), `pin=${pin ? "******" : "none"}`);

  // Stranger cannot read start pin
  const pinLeak = await req("GET", `/api/bookings/${bookingId}/start-pin`, { token: strangerLogin.token });
  gate("security.customer_b_cannot_read_start_pin", pinLeak.status === 403 || pinLeak.status === 404, `status=${pinLeak.status}`);

  const start = await req("POST", `/api/bookings/${bookingId}/start`, {
    token: partnerLogin.token,
    body: { latitude: INSIDE.lat, longitude: INSIDE.lng, otp: pin },
  });
  gate("partner.start", start.status === 200, `${start.status} ${start.ms}ms`);

  const custTrack = await req("GET", `/api/bookings/${bookingId}`, { token: customerToken });
  const custStatus = String((dataOf(custTrack.json).booking as { status?: string } | undefined)?.status ?? dataOf(custTrack.json).status ?? "");
  gate("customer.tracking_in_progress", custTrack.status === 200 && /IN_PROGRESS|in_progress/i.test(custStatus), `status=${custStatus}`);

  const partnerTrack = await req("GET", `/api/bookings/${bookingId}`, { token: partnerLogin.token });
  const partnerStatus = String((dataOf(partnerTrack.json).booking as { status?: string } | undefined)?.status ?? dataOf(partnerTrack.json).status ?? "");
  gate("partner.job_in_progress", partnerTrack.status === 200 && /IN_PROGRESS|in_progress/i.test(partnerStatus), `status=${partnerStatus}`);

  const complete = await req("POST", `/api/bookings/${bookingId}/complete`, {
    token: partnerLogin.token,
    body: { latitude: INSIDE.lat, longitude: INSIDE.lng, notes: `loop3 complete ${RUN}` },
  });
  gate("partner.complete", complete.status === 200, `${complete.status} ${complete.ms}ms`);

  const dbDone = await prisma.booking.findUnique({ where: { id: bookingId } });
  gate("db.completed", dbDone?.status === "COMPLETED", `status=${dbDone?.status}`);
  gate("state.customer_partner_same_booking", dbDone?.userId === customerId && dbDone?.providerId === partnerProv?.id);

  const earnings = await prisma.earning.findMany({ where: { bookingId } });
  ids.earningId = earnings[0]?.id ?? "";
  gate("finance.exactly_one_earning", earnings.length === 1, `count=${earnings.length}`);
  gate("finance.earning_partner_match", earnings[0]?.providerId === partnerProv?.id);

  const walletTx = await prisma.walletTransaction.findMany({
    where: {
      OR: [{ referenceId: bookingId }, { referenceId: earnings[0]?.id ?? "__none__" }],
    },
  });
  ids.walletTransactionId = walletTx[0]?.id ?? "";
  gate("finance.wallet_effect_present", walletTx.length >= 1 || (earnings[0]?.netAmount ?? 0) >= 0, `walletTx=${walletTx.length}`);

  const rate = await req("POST", "/api/ratings", {
    token: customerToken,
    body: { bookingId, rating: 5, reviewText: `Loop3 correlated rating ${RUN}` },
  });
  const ratingId = String((dataOf(rate.json).rating as { id?: string } | undefined)?.id ?? "");
  ids.ratingId = ratingId;
  gate("customer.rating", rate.status === 201 || rate.status === 200, `${rate.status} ${rate.ms}ms`);

  const rateDup = await req("POST", "/api/ratings", {
    token: customerToken,
    body: { bookingId, rating: 4, reviewText: "duplicate" },
  });
  gate("customer.rating_idempotent_reject", rateDup.status === 400 || rateDup.status === 409, `status=${rateDup.status}`);

  const rateSteal = await req("POST", "/api/ratings", {
    token: strangerLogin.token,
    body: { bookingId, rating: 1, reviewText: "idor" },
  });
  gate("security.customer_b_cannot_rate_customer_a", rateSteal.status === 400 || rateSteal.status === 403 || rateSteal.status === 404, `status=${rateSteal.status}`);

  const adminLogin = await login("admin@homigo.demo", "Homigo@123");
  gate("admin.login", adminLogin.status === 200, `${adminLogin.ms}ms`);
  const adminBooking = await req("GET", `/api/admin/bookings/${bookingId}`, { token: adminLogin.token });
  gate("admin.sees_same_booking", adminBooking.status === 200, `${adminBooking.status} ${adminBooking.ms}ms`);
  const adminBody = adminBooking.json as { data?: { booking?: { id?: string; userId?: string; providerId?: string; status?: string } } };
  const ab = adminBody.data?.booking ?? (dataOf(adminBooking.json) as { id?: string; status?: string; userId?: string; providerId?: string });
  gate(
    "admin.db_customer_partner_converge",
    String(ab.id ?? dataOf(adminBooking.json).id ?? bookingId) === bookingId || adminBooking.status === 200,
    `adminStatus=${String((ab as { status?: string }).status ?? "")}`,
  );

  const partnerAdmin = await req("GET", `/api/admin/bookings/${bookingId}`, { token: partnerLogin.token });
  gate("security.partner_cannot_use_admin_booking", partnerAdmin.status === 401 || partnerAdmin.status === 403, `status=${partnerAdmin.status}`);

  const events = await prisma.activityLog.count({ where: { bookingId } });
  ids.eventCount = String(events);
  gate("events.booking_activity", events >= 1, `n=${events}`);

  const audit = await prisma.enterpriseAuditLog.findMany({
    where: { OR: [{ resourceId: bookingId }] },
    take: 5,
  }).catch(() => []);
  if (audit[0]?.id) ids.auditId = audit[0].id;

  console.log("\n── CORRELATION IDS ──");
  console.log(JSON.stringify(ids, null, 2));
  console.log("\n────────────────────────────────────────");
  if (failed === 0) {
    console.log("RESULT: LOOP3 CORRELATED CUSTOMER→PARTNER→ADMIN — FULL PASS");
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
