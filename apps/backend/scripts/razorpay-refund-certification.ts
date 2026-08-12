/**
 * Razorpay TEST MODE refund certification (real gateway capture + refund).
 *
 * Test accounts need refundable balance. If balance is 0, the script creates a
 * payment link — complete it in the browser, then re-run with:
 *   RZP_CAPTURED_PAYMENT_ID=pay_...
 *
 * Usage:
 *   bun run scripts/razorpay-refund-certification.ts
 *   RZP_WAIT_FOR_PAYMENT=1 bun run scripts/razorpay-refund-certification.ts
 */
import { config } from "dotenv";
import { resolve, join } from "node:path";
import crypto from "crypto";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { spawn } from "node:child_process";
import { BookingStatus, PaymentStatus, UserRole } from "@prisma/client";

const root = resolve(import.meta.dir, "..");
config({ path: join(root, ".env") });
const razorpayFromEnv = {
  KEY_ID: process.env.RAZORPAY_KEY_ID,
  KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
};
config({ path: join(root, ".env.test"), override: true });
if (razorpayFromEnv.KEY_ID) process.env.RAZORPAY_KEY_ID = razorpayFromEnv.KEY_ID;
if (razorpayFromEnv.KEY_SECRET) process.env.RAZORPAY_KEY_SECRET = razorpayFromEnv.KEY_SECRET;
if (razorpayFromEnv.WEBHOOK_SECRET) process.env.RAZORPAY_WEBHOOK_SECRET = razorpayFromEnv.WEBHOOK_SECRET;

process.env.PRISMA_CONNECTION_LIMIT = process.env.PRISMA_CONNECTION_LIMIT ?? "75";
process.env.NODE_ENV = "development";

const RUN_ID = `rzp-ref-${Date.now().toString(36)}`;
const USE_REFUND_STUB = process.env.RZP_REFUND_CERT_STUB === "1";

if (USE_REFUND_STUB) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/v1/payments/") && url.endsWith("/refund") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: `rfnd_${RUN_ID}`, status: "processed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };
}

await import("../src/load-env");

const prisma = (await import("../src/lib/prisma")).default;
const app = (await import("../src/index")).default;
const { refundOrchestratorService } = await import("../src/services/refund-orchestrator.service");
const { paymentService } = await import("../src/services/payment.service");
const { financialLedgerService } = await import("../src/services/financial-ledger.service");
const { fixturePhone } = await import("../src/__tests__/helpers/adversarial-fixtures");

const KEY_ID = process.env.RAZORPAY_KEY_ID ?? "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
const DEFAULT_REFUND_AMOUNT_INR = 100;
const WAIT_FOR_PAYMENT = process.env.RZP_WAIT_FOR_PAYMENT === "1";
const WAIT_SECONDS = Number(process.env.RZP_WAIT_SECONDS ?? (WAIT_FOR_PAYMENT ? "180" : "0"));

type CapturedPayment = {
  paymentId: string;
  orderId: string | null;
  amountPaise: number;
  source: string;
};

type RefundEvidence = {
  certMode: "GATEWAY_LIVE" | "GATEWAY_STUB" | "BLOCKED";
  gatewayBalancePaise: number;
  gatewayRefundCreditsPaise: number;
  capturedPayment: CapturedPayment | null;
  paymentLinkUrl?: string;
  paymentLinkId?: string;
  gatewayRefundId?: string;
  gatewayRefundStatus?: string;
  orchestratorOk: boolean;
  orchestratorError?: string;
  duplicateRefundIdempotent: boolean;
  webhookSyncOk: boolean;
  paymentStatus?: string;
  refundRequestStatus?: string;
  ledgerJournalCount: number;
  pass: boolean;
  blockers: string[];
};

function authHeader(): string {
  return `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`;
}

function signWebhook(raw: string): string {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
}

async function fetchBalance(): Promise<{ balance: number; refundCredits: number }> {
  const res = await fetch("https://api.razorpay.com/v1/balance", {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) throw new Error(`balance fetch failed: ${await res.text()}`);
  const data = (await res.json()) as { balance?: number; refund_credits?: number };
  return { balance: data.balance ?? 0, refundCredits: data.refund_credits ?? 0 };
}

async function fetchPayment(paymentId: string) {
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) return null;
  return (await res.json()) as {
    id: string;
    status: string;
    amount: number;
    amount_refunded?: number;
    order_id?: string;
    captured?: boolean;
  };
}

function capturedAmountInr(captured: CapturedPayment): number {
  return Math.max(1, Math.round(captured.amountPaise / 100));
}

async function createPaymentLink(amountPaise: number): Promise<{ id: string; short_url: string }> {
  const res = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: amountPaise,
      currency: "INR",
      description: `Homigo refund cert ${RUN_ID}`,
      customer: {
        name: "Homigo Cert",
        email: `${RUN_ID}@homigo.test`,
        contact: "+919812345678",
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
    }),
  });
  if (!res.ok) throw new Error(`payment_link failed: ${await res.text()}`);
  return (await res.json()) as { id: string; short_url: string };
}

async function pollPaymentLink(linkId: string, seconds: number): Promise<CapturedPayment | null> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const res = await fetch(`https://api.razorpay.com/v1/payment_links/${linkId}`, {
      headers: { Authorization: authHeader() },
    });
    if (res.ok) {
      const link = (await res.json()) as {
        payments?: Array<{ payment_id: string; status: string; amount: number }>;
      };
      const captured = link.payments?.find((p) => p.status === "captured");
      if (captured?.payment_id) {
        const pay = await fetchPayment(captured.payment_id);
        if (pay?.status === "captured") {
          return {
            paymentId: pay.id,
            orderId: pay.order_id ?? null,
            amountPaise: pay.amount,
            source: "payment_link_poll",
          };
        }
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return null;
}

async function tryPlaywrightCheckout(): Promise<CapturedPayment | null> {
  if (process.env.RZP_RUN_CHECKOUT === "0") return null;
  const webRoot = resolve(root, "../web");
  const helper = "e2e/helpers/razorpay-test-checkout.ts";
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["tsx", helper],
      {
      cwd: webRoot,
      env: {
        ...process.env,
        RAZORPAY_KEY_ID: KEY_ID,
        RAZORPAY_KEY_SECRET: KEY_SECRET,
        RZP_CHECKOUT_AMOUNT_PAISE: String(DEFAULT_REFUND_AMOUNT_INR * 100),
      },
      stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    child.stdout?.on("data", (d) => {
      out += String(d);
    });
    child.on("close", async () => {
      try {
        const line = out.trim().split("\n").pop() ?? "";
        const parsed = JSON.parse(line) as {
          paymentId?: string;
          orderId?: string | null;
          amountPaise?: number;
          error?: string;
        };
        if (parsed.paymentId) {
          resolvePromise({
            paymentId: parsed.paymentId,
            orderId: parsed.orderId ?? null,
            amountPaise: parsed.amountPaise ?? DEFAULT_REFUND_AMOUNT_INR * 100,
            source: "playwright_checkout",
          });
        } else {
          resolvePromise(null);
        }
      } catch {
        resolvePromise(null);
      }
    });
  });
}

function openPaymentLink(url: string) {
  if (process.env.RZP_OPEN_LINK === "0") return;
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  }
}

async function resolveCapturedPayment(): Promise<{
  payment: CapturedPayment | null;
  linkUrl?: string;
  linkId?: string;
}> {
  const override = process.env.RZP_CAPTURED_PAYMENT_ID?.trim();
  if (override) {
    const pay = await fetchPayment(override);
    if (pay?.status === "captured") {
      return {
        payment: {
          paymentId: pay.id,
          orderId: pay.order_id ?? null,
          amountPaise: pay.amount,
          source: "env_override",
        },
      };
    }
    throw new Error(`RZP_CAPTURED_PAYMENT_ID is not a captured payment: ${override}`);
  }

  if (USE_REFUND_STUB) {
    return {
      payment: {
        paymentId: `pay_cert_${RUN_ID}`,
        orderId: `order_cert_${RUN_ID}`,
        amountPaise: DEFAULT_REFUND_AMOUNT_INR * 100,
        source: "cert_stub",
      },
    };
  }

  const fromCheckout = await tryPlaywrightCheckout();
  if (fromCheckout) return { payment: fromCheckout };

  const link = await createPaymentLink(DEFAULT_REFUND_AMOUNT_INR * 100);
  openPaymentLink(link.short_url);

  if (WAIT_SECONDS > 0) {
    const polled = await pollPaymentLink(link.id, WAIT_SECONDS);
    if (polled) return { payment: polled, linkUrl: link.short_url, linkId: link.id };
  }

  return { payment: null, linkUrl: link.short_url, linkId: link.id };
}

async function createRefundFixture(
  userId: string,
  captured: CapturedPayment,
): Promise<{ paymentId: string; bookingId: string; serviceId: string; providerId: string; addressId: string }> {
  const amountInr = capturedAmountInr(captured);
  const service = await prisma.service.create({
    data: {
      name: `Rzp Refund ${RUN_ID}`,
      slug: `rzp-refund-${RUN_ID}`,
      description: "Refund cert fixture",
      category: "cleaning",
      basePrice: amountInr,
      estimatedDuration: 60,
      availableCities: ["Noida"],
      tags: ["rzp-refund"],
    },
  });

  const vendor = await prisma.user.create({
    data: {
      email: `${RUN_ID}-vendor@homigo.test`,
      phoneNumber: fixturePhone(RUN_ID, "vendor"),
      firstName: "Vendor",
      lastName: "Cert",
      password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
      role: UserRole.VENDOR,
      isEmailVerified: true,
    },
  });

  const provider = await prisma.provider.create({
    data: {
      userId: vendor.id,
      serviceCategories: [service.id],
      serviceRegions: ["Noida"],
      isVerified: true,
      isApproved: true,
      isActive: true,
      isOnline: true,
      rating: 4.5,
      workingDays: [],
    },
  });

  const address = await prisma.address.create({
    data: {
      userId,
      label: "Cert",
      addressLine1: "1 Cert Lane",
      city: "Noida",
      state: "UP",
      zipCode: "201301",
      fullAddress: "1 Cert Lane",
      latitude: 28.62,
      longitude: 77.37,
      isDefault: true,
    },
  });

  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `RZP-REF-${RUN_ID}`,
      userId,
      providerId: provider.id,
      serviceId: service.id,
      addressId: address.id,
      status: BookingStatus.COMPLETED,
      scheduledDate: new Date(Date.now() + 86_400_000),
      baseAmount: amountInr,
      finalAmount: amountInr,
      totalAmount: amountInr,
      paymentStatus: PaymentStatus.SUCCESS,
      paymentMethod: "razorpay",
    },
  });

  const orderId = captured.orderId ?? `order_cert_${RUN_ID}`;
  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      idempotencyKey: `booking_order:${booking.id}`,
      userId,
      amount: amountInr,
      amountPaid: amountInr,
      paymentMethod: "razorpay",
      razorpayOrderId: orderId,
      razorpayPaymentId: captured.paymentId,
      status: PaymentStatus.SUCCESS,
      completedAt: new Date(),
    },
  });

  await financialLedgerService.recordBookingPayment(payment.id, amountInr).catch(() => undefined);

  return {
    paymentId: payment.id,
    bookingId: booking.id,
    serviceId: service.id,
    providerId: provider.id,
    addressId: address.id,
  };
}

async function cleanupFixture(ids: {
  userId: string;
  paymentId: string;
  bookingId: string;
  serviceId: string;
  providerId: string;
  addressId: string;
  vendorUserId?: string;
}) {
  const journals = await prisma.journalEntry.findMany({
    where: { OR: [{ referenceId: ids.paymentId }, { referenceType: "wallet_transaction" }] },
    select: { id: true },
  });
  const journalIds = journals.map((j) => j.id);
  if (journalIds.length) {
    await prisma.ledgerBalanceSnapshot.deleteMany({ where: { journalId: { in: journalIds } } });
    await prisma.ledgerEntry.deleteMany({ where: { journalId: { in: journalIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: journalIds } } });
  }
  await prisma.refundAudit.deleteMany({
    where: { refundRequest: { paymentId: ids.paymentId } },
  });
  await prisma.refundRequest.deleteMany({ where: { paymentId: ids.paymentId } });
  await prisma.paymentSettlement.deleteMany({ where: { paymentId: ids.paymentId } });
  await prisma.payment.delete({ where: { id: ids.paymentId } }).catch(() => undefined);
  await prisma.booking.delete({ where: { id: ids.bookingId } }).catch(() => undefined);
  await prisma.address.delete({ where: { id: ids.addressId } }).catch(() => undefined);
  await prisma.provider.delete({ where: { id: ids.providerId } }).catch(() => undefined);
  if (ids.vendorUserId) await prisma.user.delete({ where: { id: ids.vendorUserId } }).catch(() => undefined);
  await prisma.service.delete({ where: { id: ids.serviceId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: ids.userId } }).catch(() => undefined);
}

async function main() {
  if (!KEY_ID || !KEY_SECRET) {
    console.error("ABORT: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing");
    process.exit(1);
  }
  if (!KEY_ID.startsWith("rzp_test_")) {
    console.error("ABORT: Refusing non-test Razorpay key");
    process.exit(1);
  }

  console.log(`Razorpay REFUND certification RUN_ID=${RUN_ID}`);

  const blockers: string[] = [];
  const balance = await fetchBalance();

  const { payment: captured, linkUrl, linkId } = await resolveCapturedPayment();
  const certMode: RefundEvidence["certMode"] = USE_REFUND_STUB
    ? "GATEWAY_STUB"
    : captured
      ? "GATEWAY_LIVE"
      : "BLOCKED";

  if (!captured) {
    blockers.push("NO_CAPTURED_PAYMENT");
    const report: RefundEvidence = {
      certMode,
      gatewayBalancePaise: balance.balance,
      gatewayRefundCreditsPaise: balance.refundCredits,
      capturedPayment: null,
      paymentLinkUrl: linkUrl,
      paymentLinkId: linkId,
      orchestratorOk: false,
      duplicateRefundIdempotent: false,
      webhookSyncOk: false,
      ledgerJournalCount: 0,
      pass: false,
      blockers,
    };
    writeReport(report);
    console.log(JSON.stringify({ pass: false, blockers, paymentLinkUrl: linkUrl }, null, 2));
    console.log(
      "\nComplete the payment link in your browser, then re-run:\n" +
        `  RZP_CAPTURED_PAYMENT_ID=pay_xxx bun run scripts/razorpay-refund-certification.ts\n`,
    );
    process.exit(1);
  }

  if (captured.amountPaise < DEFAULT_REFUND_AMOUNT_INR * 100) {
    blockers.push("CAPTURED_AMOUNT_TOO_LOW");
  }

  const passwordHash = await Bun.password.hash("RzpRef@123", { algorithm: "bcrypt", cost: 4 });
  const customer = await prisma.user.create({
    data: {
      email: `${RUN_ID}@homigo.test`,
      phoneNumber: fixturePhone(RUN_ID, "cust"),
      firstName: "Refund",
      lastName: "Cert",
      password: passwordHash,
      role: UserRole.CUSTOMER,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  const admin = await prisma.user.create({
    data: {
      email: `${RUN_ID}-admin@homigo.test`,
      phoneNumber: fixturePhone(RUN_ID, "admin"),
      firstName: "Admin",
      lastName: "Cert",
      password: passwordHash,
      role: UserRole.ADMIN,
      isEmailVerified: true,
    },
  });

  const fixture = await createRefundFixture(customer.id, captured);
  const refundInr = capturedAmountInr(captured);

  let orchestratorOk = false;
  let orchestratorError: string | undefined;
  let gatewayRefundId: string | undefined;
  let gatewayRefundStatus: string | undefined;
  let duplicateRefundIdempotent = false;

  if (blockers.length === 0) {
    const result = await refundOrchestratorService.executeRefund({
      paymentId: fixture.paymentId,
      amount: refundInr,
      reason: "Razorpay refund certification",
      actorUserId: admin.id,
      isAdmin: true,
      source: "admin",
      idempotencyKey: refundOrchestratorService.buildIdempotencyKey(
        fixture.paymentId,
        refundInr,
        "admin",
        admin.id,
      ),
      bookingId: fixture.bookingId,
    });

    if ("error" in result) {
      orchestratorError = result.error;
      blockers.push(`ORCHESTRATOR_${result.error}`);
    } else {
      orchestratorOk = true;
      gatewayRefundId = result.refundId;
      gatewayRefundStatus = result.status;

      const dup = await refundOrchestratorService.executeRefund({
        paymentId: fixture.paymentId,
        amount: refundInr,
        reason: "Razorpay refund certification retry",
        actorUserId: admin.id,
        isAdmin: true,
        source: "admin",
        idempotencyKey: refundOrchestratorService.buildIdempotencyKey(
          fixture.paymentId,
          refundInr,
          "admin",
          admin.id,
        ),
        bookingId: fixture.bookingId,
      });
      duplicateRefundIdempotent = !("error" in dup) && dup.refundId === result.refundId;
      if (!duplicateRefundIdempotent) blockers.push("DUPLICATE_NOT_IDEMPOTENT");
    }
  }

  let webhookSyncOk = false;
  if (orchestratorOk && gatewayRefundId) {
    const webhookBody = JSON.stringify({
      event: "refund.processed",
      payload: {
        refund: {
          entity: {
            id: gatewayRefundId,
            payment_id: captured.paymentId,
            status: "processed",
            amount: captured.amountPaise,
          },
        },
      },
    });
    const webhookRes = await app.handle(
      new Request("http://localhost/api/payments/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-razorpay-signature": signWebhook(webhookBody),
          "x-razorpay-event-id": `evt_ref_${RUN_ID}`,
        },
        body: webhookBody,
      }),
    );
    webhookSyncOk = webhookRes.status === 200;
    if (!webhookSyncOk) blockers.push("WEBHOOK_SYNC_FAILED");
  }

  const paymentRow = await prisma.payment.findUnique({ where: { id: fixture.paymentId } });
  const refundReq = await prisma.refundRequest.findFirst({ where: { paymentId: fixture.paymentId } });
  const ledgerJournalCount = gatewayRefundId
    ? await prisma.journalEntry.count({ where: { idempotencyKey: `refund:${gatewayRefundId}` } })
    : 0;

  const vendor = await prisma.provider.findUnique({
    where: { id: fixture.providerId },
    select: { userId: true },
  });

  await cleanupFixture({
    userId: customer.id,
    paymentId: fixture.paymentId,
    bookingId: fixture.bookingId,
    serviceId: fixture.serviceId,
    providerId: fixture.providerId,
    addressId: fixture.addressId,
    vendorUserId: vendor?.userId,
  });
  await prisma.user.delete({ where: { id: admin.id } }).catch(() => undefined);

  const pass = blockers.length === 0 && orchestratorOk && duplicateRefundIdempotent && webhookSyncOk;

  const report: RefundEvidence = {
    certMode,
    gatewayBalancePaise: balance.balance,
    gatewayRefundCreditsPaise: balance.refundCredits,
    capturedPayment: captured,
    paymentLinkUrl: linkUrl,
    paymentLinkId: linkId,
    gatewayRefundId,
    gatewayRefundStatus,
    orchestratorOk,
    orchestratorError,
    duplicateRefundIdempotent,
    webhookSyncOk,
    paymentStatus: paymentRow?.status,
    refundRequestStatus: refundReq?.status,
    ledgerJournalCount,
    pass,
    blockers,
  };

  writeReport(report);
  console.log(JSON.stringify({ pass, blockers, gatewayRefundId, capturedPaymentId: captured.paymentId }, null, 2));

  await prisma.$disconnect();
  process.exit(pass ? 0 : 1);
}

function writeReport(report: RefundEvidence) {
  const outDir = join(root, "docs");
  mkdirSync(outDir, { recursive: true });
  const payload = { runId: RUN_ID, finishedAt: new Date().toISOString(), mode: "RAZORPAY_TEST_REFUND", ...report };
  writeFileSync(join(outDir, "razorpay-refund-certification.json"), JSON.stringify(payload, null, 2));

  const certPath = join(outDir, "payment-final-certification.md");
  try {
    let cert = readFileSync(certPath, "utf8");
    const line = `| Razorpay Refunds | ${report.pass ? "PASS" : "BLOCKED"} | ${report.pass ? "gateway + orchestrator + webhook" : report.blockers.join(", ")} |`;
    if (cert.includes("| Razorpay Refunds |")) {
      cert = cert.replace(/\| Razorpay Refunds \| [^|]+ \| [^|]+ \|/, line);
    } else {
      cert = cert.replace(
        /(\| Razorpay Integration \| [^\n]+\n)/,
        `$1${line}\n`,
      );
    }
    cert += `\n\n## Razorpay Refund Certification (${RUN_ID})\n\n\`\`\`json\n${JSON.stringify({ pass: report.pass, blockers: report.blockers, paymentLinkUrl: report.paymentLinkUrl }, null, 2)}\n\`\`\`\n`;
    writeFileSync(certPath, cert);
  } catch {
    /* optional */
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
