/**
 * E2E: create paid booking → cancel → verify refund (wallet + optional Razorpay).
 *
 * Usage:
 *   bun run scripts/e2e-cancel-refund.ts
 *   bun run scripts/e2e-cancel-refund.ts --gateway   # also test Razorpay stub/live
 */
import "../src/load-env";
import { PaymentStatus, RefundRequestStatus, WalletTxnType } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";
import { userPiiService } from "../src/services/user-pii.service";
import { bookingRefundService } from "../src/services/booking-refund.service";

const testGateway = process.argv.includes("--gateway");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function seedWalletPaidBooking(customerId: string, addressId: string, serviceId: string) {
  const created = await bookingService.create(customerId, {
    serviceId,
    scheduledDate: new Date(Date.now() + 7 * 86400_000).toISOString(),
    addressId,
    paymentMethod: "wallet",
  });
  if ("error" in created) throw new Error(`create failed: ${created.error}`);

  const bookingId = created.booking.id;
  const amount = created.booking.finalAmount;

  await prisma.user.update({
    where: { id: customerId },
    data: { walletBalance: { increment: amount + 500 } },
  });

  await prisma.payment.upsert({
    where: { bookingId },
    create: {
      bookingId,
      idempotencyKey: `e2e-wallet:${bookingId}`,
      userId: customerId,
      amount,
      amountPaid: amount,
      paymentMethod: "wallet",
      razorpayOrderId: `wallet:${bookingId}`,
      status: PaymentStatus.SUCCESS,
      completedAt: new Date(),
    },
    update: {
      amount,
      amountPaid: amount,
      paymentMethod: "wallet",
      status: PaymentStatus.SUCCESS,
      completedAt: new Date(),
    },
  });

  await prisma.booking.update({
    where: { id: bookingId },
    data: { paymentStatus: PaymentStatus.SUCCESS },
  });

  return { bookingId, amount };
}

async function verifyWalletRefund(bookingId: string, customerId: string, expectedRefund: number) {
  await sleep(1500);

  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  const refundReq = await prisma.refundRequest.findUnique({
    where: { idempotencyKey: `cancel-refund:${bookingId}` },
  });
  const walletTxn = await prisma.walletTransaction.findUnique({
    where: { idempotencyKey: `wallet-cancel-refund:${bookingId}` },
  });
  const journal = await prisma.journalEntry.findUnique({
    where: { idempotencyKey: `wallet_booking_refund:${bookingId}` },
  });

  const ok =
    booking?.status === "CANCELLED_BY_USER" &&
    (booking.refundStatus === "processed" || booking.refundStatus === "pending") &&
    refundReq?.status === RefundRequestStatus.COMPLETED &&
    walletTxn?.type === WalletTxnType.REFUND &&
    walletTxn.amount === expectedRefund &&
    journal != null;

  return {
    ok,
    bookingStatus: booking?.status,
    refundStatus: booking?.refundStatus,
    refundAmount: booking?.refundAmount,
    refundRequestStatus: refundReq?.status,
    walletTxnAmount: walletTxn?.amount,
    ledgerPosted: Boolean(journal),
  };
}

async function testWalletPath() {
  const customer = await userPiiService.findByEmail("customer@homigo.demo");
  if (!customer) throw new Error("Run ensure:demo-users first");

  const addr = await prisma.address.findFirst({ where: { userId: customer.id } });
  const service = await prisma.service.findFirst({ where: { isActive: true } });
  if (!addr || !service) throw new Error("Missing address/service");

  const balanceBefore = (
    await prisma.user.findUnique({ where: { id: customer.id }, select: { walletBalance: true } })
  )?.walletBalance ?? 0;

  const { bookingId, amount } = await seedWalletPaidBooking(customer.id, addr.id, service.id);

  const quote = await bookingRefundService.quoteForBooking(bookingId, "user");
  if (!quote) throw new Error("quote missing");

  const cancel = await bookingService.cancel(
    { userId: customer.id },
    bookingId,
    "E2E wallet refund test",
  );
  if ("error" in cancel) throw new Error(`cancel failed: ${cancel.error}`);

  const verify = await verifyWalletRefund(bookingId, customer.id, quote.refundAmount);

  const balanceAfter = (
    await prisma.user.findUnique({ where: { id: customer.id }, select: { walletBalance: true } })
  )?.walletBalance ?? 0;

  return {
    channel: "wallet",
    bookingId,
    paidAmount: amount,
    quote,
    cancel,
    verify,
    balanceBefore,
    balanceAfter,
    balanceDelta: Math.round((balanceAfter - balanceBefore) * 100) / 100,
    pass: verify.ok && verify.refundAmount === quote.refundAmount,
  };
}

async function testGatewayPath() {
  const hasKeys = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  if (!hasKeys) {
    return { channel: "razorpay", skipped: true, reason: "RAZORPAY_KEY_ID/SECRET not set" };
  }

  // Use stub fetch for safe test-mode refund without burning balance
  const RUN = `e2e-${Date.now()}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/v1/payments/") && url.endsWith("/refund") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: `rfnd_${RUN}`, status: "processed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return originalFetch(input, init);
  };

  try {
    const customer = await userPiiService.findByEmail("customer@homigo.demo");
    if (!customer) throw new Error("customer missing");

    const addr = await prisma.address.findFirst({ where: { userId: customer.id } });
    const service = await prisma.service.findFirst({ where: { isActive: true } });
    if (!addr || !service) throw new Error("Missing address/service");

    const created = await bookingService.create(customer.id, {
      serviceId: service.id,
      scheduledDate: new Date(Date.now() + 7 * 86400_000).toISOString(),
      addressId: addr.id,
      paymentMethod: "razorpay",
    });
    if ("error" in created) throw new Error(created.error);

    const bookingId = created.booking.id;
    const amount = created.booking.finalAmount;

    await prisma.payment.upsert({
      where: { bookingId },
      create: {
        bookingId,
        idempotencyKey: `e2e-rzp:${bookingId}`,
        userId: customer.id,
        amount,
        amountPaid: amount,
        paymentMethod: "razorpay",
        razorpayOrderId: `order_${RUN}`,
        razorpayPaymentId: `pay_${RUN}`,
        status: PaymentStatus.SUCCESS,
        completedAt: new Date(),
      },
      update: {
        status: PaymentStatus.SUCCESS,
        razorpayPaymentId: `pay_${RUN}`,
        amountPaid: amount,
      },
    });
    await prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: PaymentStatus.SUCCESS },
    });

    const cancel = await bookingService.cancel(
      { userId: customer.id },
      bookingId,
      "E2E gateway refund test",
    );
    if ("error" in cancel) throw new Error(cancel.error);

    await sleep(2000);

    const refundReq = await prisma.refundRequest.findUnique({
      where: { idempotencyKey: `cancel-refund:${bookingId}` },
    });
    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    const journal = await prisma.journalEntry.findFirst({
      where: { idempotencyKey: { startsWith: "refund:" } },
      orderBy: { createdAt: "desc" },
    });

    const pass =
      refundReq?.status === RefundRequestStatus.COMPLETED &&
      Boolean(refundReq.gatewayRefundId) &&
      payment?.refundedAmount === cancel.refundAmount;

    return {
      channel: "razorpay",
      skipped: false,
      bookingId,
      cancel,
      refundRequestStatus: refundReq?.status,
      gatewayRefundId: refundReq?.gatewayRefundId,
      paymentRefunded: payment?.refundedAmount,
      ledgerPosted: Boolean(journal),
      pass,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log("=== E2E Cancel + Refund Verification ===\n");

const wallet = await testWalletPath();
console.log("WALLET PATH:");
console.log(JSON.stringify(wallet, null, 2));

let gateway: Awaited<ReturnType<typeof testGatewayPath>> | null = null;
if (testGateway) {
  gateway = await testGatewayPath();
  console.log("\nRAZORPAY PATH:");
  console.log(JSON.stringify(gateway, null, 2));
}

const allPass = wallet.pass && (!gateway || gateway.skipped || gateway.pass);
console.log(allPass ? "\n✅ REFUND E2E PASS" : "\n❌ REFUND E2E FAIL");

await prisma.$disconnect();
process.exit(allPass ? 0 : 1);
