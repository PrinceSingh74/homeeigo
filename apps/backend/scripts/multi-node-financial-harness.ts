/**
 * MULTI-NODE Financial Harness — proves wallet financial integrity holds when the
 * load comes from SEPARATE OS PROCESSES (simulated multi-instance deployment), where
 * each node has its OWN in-memory lock. Cross-process safety therefore rests entirely
 * on the DB guards (pg_advisory_xact_lock, FOR UPDATE, idempotencyKey, SERIALIZABLE).
 *
 * Runs ONLY against the isolated homigo_test DB (NODE_ENV=test enforced by load-env).
 *
 *   NODE_ENV=test bun run scripts/multi-node-financial-harness.ts
 *
 * Worker modes (spawned internally):
 *   worker settle <userId> <pairsCsv>      one settle op per "orderId|paymentId" pair
 *   worker credit <userId> <amount> <n>    n× (addMoney → verifyTopUp) on shared wallet
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { walletService } from "../src/services/wallet.service";
import { financialIntegrityService } from "../src/services/financial-integrity.service";

const SELF = import.meta.path ?? import.meta.url.replace("file://", "");
const RETRYABLE = new Set(["P2037", "P2034", "P2028"]); // conn-saturation / write-conflict / tx-timeout

// A real multi-instance node tolerates transient infra faults: connection saturation
// (P2037 — Postgres max_connections is shared with the live backend), write conflicts,
// and the app's anti-abuse pending cap (TOO_MANY_PENDING). Business idempotency
// rejections are NOT retried — that single-credit behaviour is what we are proving.
async function withRetry<T>(fn: () => Promise<T>, attempts = 20): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (RETRYABLE.has(e?.code) && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 40 + Math.random() * 120 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error("retry exhausted");
}

async function runWorkerSettle(userId: string, pairsCsv: string) {
  const pairs = pairsCsv.split(",").map((p) => p.split("|"));
  await Promise.allSettled(
    pairs.map(([orderId, paymentId], i) =>
      withRetry(() =>
        i % 2 === 0
          ? walletService.verifyTopUp(userId, { razorpayOrderId: orderId!, razorpayPaymentId: paymentId!, razorpaySignature: "sig" })
          : walletService.reconcileTopUpFromWebhook(orderId!, paymentId!),
      ),
    ),
  );
  await prisma.$disconnect();
}

async function runWorkerCredit(userId: string, amount: number, rounds: number) {
  const dbg = process.env.MN_DEBUG ? (m: string) => console.error(`W${process.pid}: ${m}`) : () => {};
  let done = 0;
  // create→settle loop keeps this node's pending top-ups at ≤1 at any instant, so N
  // concurrent nodes stay under MAX_PENDING_WALLET_TOPUPS while all credit ONE wallet.
  for (let r = 0; r < rounds; r++) {
    // Retry create and settle SEPARATELY: wrapping both together would re-create a new
    // top-up whenever the settle hit P2037, orphaning the prior PENDING row and filling
    // the anti-abuse pending cap. Create once (retry on saturation/pending-cap), then
    // settle that SAME top-up to completion before the next round.
    let order: string;
    try {
      order = await withRetry(async () => {
        const t = await walletService.addMoney(userId, amount);
        if ("error" in t) throw Object.assign(new Error(t.error), { code: "P2034" }); // treat as retryable transient
        return t.razorpayOrderId;
      });
    } catch (e: any) { dbg(`addMoney FAILED round ${r}: code=${e?.code} name=${e?.constructor?.name} msg=${JSON.stringify(e?.message)?.slice(0,160)}`); throw e; }
    try {
      await withRetry(() =>
        walletService.verifyTopUp(userId, { razorpayOrderId: order, razorpayPaymentId: `pay_mn_${userId.slice(-4)}_${r}_${Date.now()}`, razorpaySignature: "sig" }),
      );
      done++;
    } catch (e: any) { dbg(`settle FAILED round ${r}: code=${e?.code} ${e?.message}`); throw e; }
  }
  dbg(`DONE completed ${done}/${rounds}`);
  await prisma.$disconnect();
}

function spawnNode(args: string[]) {
  // Separate OS process (NOT `bun run <abs-path-with-spaces>`, which mis-resolves on Windows).
  return Bun.spawn([process.argv[0]!, SELF, "worker", ...args], {
    env: { ...process.env, NODE_ENV: "test" },
    stdout: "ignore",
    stderr: process.env.MN_DEBUG ? "inherit" : "ignore",
  });
}

async function makeUser() {
  return prisma.user.create({
    data: { email: `mn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@homigo.test`, phoneNumber: `+9196${Math.floor(1000000 + Math.random() * 8999999)}`, firstName: "Mn", lastName: "Node", password: "x".repeat(20), walletBalance: 0 },
  });
}

async function cleanup(userId: string) {
  const txns = await prisma.walletTransaction.findMany({ where: { userId }, select: { id: true } });
  await prisma.journalEntry.deleteMany({ where: { referenceId: { in: txns.map((t) => t.id) } } }).catch(() => {});
  await prisma.walletTransaction.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
}

/** Scenario A — K nodes × J ops all settle the SAME top-up → exactly ONE credit. */
async function scenarioIdempotency(nodes: number, opsPerNode: number) {
  const user = await makeUser();
  const topUp = await walletService.addMoney(user.id, 500);
  if ("error" in topUp) throw new Error("setup: " + topUp.error);
  const pair = `${topUp.razorpayOrderId}|pay_mn_${Date.now()}`;
  const csv = Array.from({ length: opsPerNode }, () => pair).join(",");

  const procs = Array.from({ length: nodes }, () => spawnNode(["settle", user.id, csv]));
  await Promise.all(procs.map((p) => p.exited));

  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const completed = await prisma.walletTransaction.count({ where: { userId: user.id, status: "COMPLETED" } });
  const txn = await prisma.walletTransaction.findFirstOrThrow({ where: { userId: user.id, referenceId: topUp.razorpayOrderId } });
  const journals = await prisma.journalEntry.count({ where: { referenceId: txn.id, referenceType: "wallet_transaction" } });

  const pass = after.walletBalance === 500 && completed === 1 && journals === 1;
  console.log(`  [A idempotency] ${nodes} nodes × ${opsPerNode} ops (${nodes * opsPerNode} concurrent settles, SAME top-up)  → balance=${after.walletBalance}/500  completed=${completed}/1  journals=${journals}/1  → ${pass ? "✅ ONE credit" : "❌ DOUBLE-CREDIT"}`);
  await cleanup(user.id);
  return pass;
}

/** Scenario B — K nodes each credit the SAME wallet R times concurrently → balance == K·R·amount, no lost update. */
async function scenarioNoLostUpdate(nodes: number, rounds: number, amount = 100) {
  const user = await makeUser();
  const procs = Array.from({ length: nodes }, () => spawnNode(["credit", user.id, String(amount), String(rounds)]));
  await Promise.all(procs.map((p) => p.exited));

  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const completed = await prisma.walletTransaction.count({ where: { userId: user.id, status: "COMPLETED" } });
  const expected = nodes * rounds * amount;
  const pass = after.walletBalance === expected && completed === nodes * rounds;
  console.log(`  [B no-lost-update] ${nodes} nodes × ${rounds} credits × ₹${amount} on ONE wallet  → balance=${after.walletBalance}/${expected}  completed=${completed}/${nodes * rounds}  → ${pass ? "✅ every credit applied once" : "❌ LOST/DOUBLE UPDATE"}`);
  await cleanup(user.id);
  return pass;
}

async function main() {
  if (process.argv[2] === "worker") {
    const mode = process.argv[3];
    if (mode === "settle") await runWorkerSettle(process.argv[4]!, process.argv[5]!);
    else if (mode === "credit") await runWorkerCredit(process.argv[4]!, Number(process.argv[5]), Number(process.argv[6]));
    process.exit(0);
  }

  if (process.env.NODE_ENV !== "test") {
    console.error("REFUSING to run outside NODE_ENV=test (financial writes must hit homigo_test only).");
    process.exit(2);
  }

  const ledgerCats = ["LEDGER_IMBALANCE", "WALLET_LIABILITY_MISMATCH", "DUPLICATE_JOURNAL", "DUPLICATE_PAYOUT", "NEGATIVE_BALANCE", "MISSING_LEDGER_ENTRY", "ORPHAN_JOURNAL"];
  const countLedger = async () => (await financialIntegrityService.validate()).issues.filter((i) => ledgerCats.includes(i.category)).length;
  const baseline = await countLedger();
  console.log(`🌐 MULTI-NODE financial harness (separate OS processes, isolated homigo_test) — baseline ledger issues=${baseline}:`);
  let all = true;
  all = (await scenarioIdempotency(6, 15)) && all;   // 90 concurrent settles, one top-up
  all = (await scenarioIdempotency(10, 25)) && all;  // 250 concurrent settles, one top-up
  all = (await scenarioNoLostUpdate(8, 5)) && all;   // 8 nodes × 5 credits → balance 4000
  all = (await scenarioNoLostUpdate(8, 10)) && all;  // 8 nodes × 10 credits → balance 8000

  console.log("\n🔎 Global financial integrity AFTER multi-node storm:");
  const integ = await financialIntegrityService.validate();
  const after = integ.issues.filter((i) => ledgerCats.includes(i.category)).length;
  const introduced = after - baseline;
  console.log(`  integrity score=${integ.score}/100  ledger-class issues: baseline=${baseline} after=${after}  → introduced by harness=${introduced}`);

  const verdict = all && introduced <= 0;
  console.log(`\n${verdict ? "✅ MULTI-NODE CERTIFIED" : "❌ MULTI-NODE DEFECT"} — DB-level guards hold across separate processes (in-memory locks bypassed).`);
  await prisma.$disconnect();
  process.exit(verdict ? 0 : 1);
}

main().catch((e) => { console.error("fatal:", e); process.exit(1); });
