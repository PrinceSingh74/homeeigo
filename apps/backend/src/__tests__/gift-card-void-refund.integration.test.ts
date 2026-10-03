/**
 * Gift card void refunds the unspent balance to the ORIGINAL payment exactly once — never also to the
 * wallet (the P1 double credit this path used to have), never twice under retries or concurrency, and
 * never from a card with no provable payment. The gateway is stubbed; the database is the isolated test DB.
 */
import "../load-env";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { GiftCardStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import app from "../index";
import { giftCardService } from "../services/gift-card.service";
import { razorpayService } from "../services/razorpay.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `gcv-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
const cardIds: string[] = [];
const spies: Array<{ mockRestore: () => void }> = [];

async function makeCard(opts: { balance?: number; amount?: number; order?: string | null } = {}) {
  const amount = opts.amount ?? 300;
  const card = await prisma.giftCard.create({
    data: {
      code: `HG-${RUN.slice(-4).toUpperCase()}-${cardIds.length.toString().padStart(4, "0")}-VD`,
      purchaserId: ctx.customerA.id,
      amount,
      balance: opts.balance ?? amount,
      status: GiftCardStatus.ACTIVE,
      razorpayOrderId: opts.order === undefined ? `order_${RUN}_${cardIds.length}` : opts.order,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  cardIds.push(card.id);
  return card;
}
function stubGateway(opts: { captured?: boolean; authorized?: boolean; refund?: "ok" | "unknown" | "reject" } = {}) {
  const calls: Array<{ paymentId: string; amount: number; key?: string }> = [];
  spies.push(
    spyOn(razorpayService, "fetchOrderPayments").mockImplementation(async () =>
      opts.captured === false ? (opts.authorized ? [{ id: "pay_auth", status: "authorized" }] : []) : [{ id: `pay_${RUN}`, status: "captured" }],
    ) as never,
  );
  spies.push(
    spyOn(razorpayService, "createRefund").mockImplementation(async (paymentId: string, amount: number, key?: string) => {
      calls.push({ paymentId, amount, key });
      if (opts.refund === "unknown") throw Object.assign(new Error("Refund outcome unknown: TIMEOUT"), { outcomeUnknown: true });
      if (opts.refund === "reject") throw new Error("Refund failed: BAD_REQUEST");
      return { refundId: `rfnd_${RUN}_${key}`, status: "processed" };
    }) as never,
  );
  return calls;
}
const wallet = async () => (await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { walletBalance: true, walletBalancePaise: true } }));
const giftWalletTxns = () => prisma.walletTransaction.count({ where: { userId: ctx.customerA.id, referenceType: { in: ["gift_card_void_refund", "gift_card_refund"] } } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
}, 90_000);
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });
afterAll(async () => {
  if (!dbOk) return;
  await prisma.journalEntry.deleteMany({ where: { idempotencyKey: { in: cardIds.map((id) => `gift_card_void:${id}`) } } }).catch(() => {});
  await prisma.giftCardTransaction.deleteMany({ where: { giftCardId: { in: cardIds } } }).catch(() => {});
  await prisma.giftCard.deleteMany({ where: { id: { in: cardIds } } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("gift card void — refund to the original payment, exactly once", () => {
  test("void refunds the balance to the gateway once, credits the wallet NEVER, reverses the purchase journal", async () => {
    if (!dbOk) return;
    const card = await makeCard();
    const calls = stubGateway();
    const before = await wallet();
    const r = await giftCardService.void(ctx.customerA.id, card.id);
    expect(r).toMatchObject({ ok: true, refunded: 300, refundedTo: "ORIGINAL_PAYMENT" });
    expect(calls).toEqual([{ paymentId: `pay_${RUN}`, amount: 300, key: `gift_void:${card.id}` }]);
    expect(await wallet()).toEqual(before);
    expect(await giftWalletTxns()).toBe(0);
    const after = await prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } });
    expect([after.status, after.balance]).toEqual([GiftCardStatus.VOID, 0]);
    const rows = await prisma.giftCardTransaction.findMany({ where: { giftCardId: card.id }, orderBy: { createdAt: "asc" }, select: { type: true, amount: true } });
    expect(rows).toEqual([{ type: "VOID_RESERVED", amount: 300 }, { type: "REFUND", amount: 300 }]);
    const journal = await prisma.journalEntry.findUniqueOrThrow({ where: { idempotencyKey: `gift_card_void:${card.id}` }, include: { lines: { include: { account: true } } } });
    const byAccount = Object.fromEntries(journal.lines.map((l) => [l.account.code, [Number(l.debit), Number(l.credit)]]));
    expect(byAccount).toEqual({ PLATFORM_ESCROW: [300, 0], CUSTOMER_FUNDS: [0, 300] });
  });

  test("a repeated void is refused without a second gateway refund", async () => {
    if (!dbOk) return;
    const card = await makeCard();
    const calls = stubGateway();
    expect(await giftCardService.void(ctx.customerA.id, card.id)).toMatchObject({ ok: true });
    expect(await giftCardService.void(ctx.customerA.id, card.id)).toEqual({ error: "ALREADY_VOIDED" });
    expect(calls.length).toBe(1);
  });

  test("concurrent voids: one completion, one journal, every gateway call carries the same idempotency key", async () => {
    if (!dbOk) return;
    const card = await makeCard();
    const calls = stubGateway();
    const before = await wallet();
    const results = await Promise.all(Array.from({ length: 5 }, () => giftCardService.void(ctx.customerA.id, card.id)));
    expect(results.filter((r) => "ok" in r).length).toBeGreaterThanOrEqual(1);
    expect(new Set(calls.map((c) => c.key))).toEqual(new Set([`gift_void:${card.id}`]));
    expect(calls.every((c) => c.amount === 300)).toBe(true);
    expect(await prisma.giftCardTransaction.count({ where: { giftCardId: card.id, type: "REFUND" } })).toBe(1);
    expect(await prisma.giftCardTransaction.count({ where: { giftCardId: card.id, type: "VOID_RESERVED" } })).toBe(1);
    expect(await prisma.journalEntry.count({ where: { idempotencyKey: `gift_card_void:${card.id}` } })).toBe(1);
    expect(await wallet()).toEqual(before);
  });

  test("a partially redeemed card refunds only the unspent balance", async () => {
    if (!dbOk) return;
    const card = await makeCard({ amount: 300, balance: 120 });
    const calls = stubGateway();
    expect(await giftCardService.void(ctx.customerA.id, card.id)).toMatchObject({ ok: true, refunded: 120 });
    expect(calls[0]!.amount).toBe(120);
  });

  test("unknown gateway outcome keeps the reservation (redeem blocked); the retry resumes with the same key and amount", async () => {
    if (!dbOk) return;
    const card = await makeCard();
    const first = stubGateway({ refund: "unknown" });
    expect(await giftCardService.void(ctx.customerA.id, card.id)).toEqual({ error: "GATEWAY_REFUND_PENDING" });
    const mid = await prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } });
    expect([mid.status, mid.balance]).toEqual([GiftCardStatus.ACTIVE, 0]);
    const redeem = await giftCardService.redeem(ctx.customerB.id, card.code);
    expect("ok" in redeem).toBe(false);
    while (spies.length) spies.pop()!.mockRestore();
    const second = stubGateway();
    expect(await giftCardService.void(ctx.customerA.id, card.id)).toMatchObject({ ok: true, refunded: 300 });
    expect([first[0]!.key, second[0]!.key]).toEqual([`gift_void:${card.id}`, `gift_void:${card.id}`]);
    expect(second[0]!.amount).toBe(300);
    expect(await prisma.giftCardTransaction.count({ where: { giftCardId: card.id, type: "VOID_RESERVED" } })).toBe(1);
  });

  test("a definitive gateway rejection releases the reservation and restores the balance", async () => {
    if (!dbOk) return;
    const card = await makeCard();
    stubGateway({ refund: "reject" });
    expect(await giftCardService.void(ctx.customerA.id, card.id)).toEqual({ error: "GATEWAY_REFUND_FAILED" });
    const after = await prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } });
    expect([after.status, after.balance]).toEqual([GiftCardStatus.ACTIVE, 300]);
    const types = (await prisma.giftCardTransaction.findMany({ where: { giftCardId: card.id }, orderBy: { createdAt: "asc" } })).map((t) => t.type);
    expect(types).toEqual(["VOID_RESERVED", "VOID_RELEASED"]);
  });

  test("no provable payment → refused; nothing is credited anywhere", async () => {
    if (!dbOk) return;
    const before = await wallet();
    const noOrder = await makeCard({ order: null });
    const calls = stubGateway();
    expect(await giftCardService.void(ctx.customerA.id, noOrder.id)).toEqual({ error: "NO_REFUNDABLE_PAYMENT" });
    while (spies.length) spies.pop()!.mockRestore();
    const uncaptured = await makeCard();
    stubGateway({ captured: false });
    expect(await giftCardService.void(ctx.customerA.id, uncaptured.id)).toEqual({ error: "NO_REFUNDABLE_PAYMENT" });
    expect(calls.length).toBe(0);
    expect(await wallet()).toEqual(before);
    for (const c of [noOrder, uncaptured]) expect((await prisma.giftCard.findUniqueOrThrow({ where: { id: c.id } })).balance).toBe(300);
  });

  test("HTTP: the customer is told the money went to the original payment method", async () => {
    if (!dbOk) return;
    const card = await makeCard();
    stubGateway();
    const res = await app.handle(new Request(`http://localhost/api/giftcards/${card.id}/void`, { method: "POST", headers: { Authorization: `Bearer ${bearer(ctx.customerA)}` } }));
    const body = (await res.json()) as { success: boolean; message: string; data: { refundedTo: string } };
    expect(res.status).toBe(200);
    expect(body.message).toContain("original payment method");
    expect(body.message).not.toContain("wallet");
    expect(body.data.refundedTo).toBe("ORIGINAL_PAYMENT");
  });
});
