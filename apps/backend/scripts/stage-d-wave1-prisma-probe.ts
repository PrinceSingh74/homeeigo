/**
 * Stage D Wave-1 — Prisma critical-path compatibility probe (read-only).
 * Proves no P2021/P2022 on models touched by stage-d-staging-certification.ts.
 *
 *   DATABASE_URL=postgresql://... bun run scripts/stage-d-wave1-prisma-probe.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Probe = { name: string; run: () => Promise<unknown> };

const probes: Probe[] = [
  {
    name: "user.findFirst+addresses (D1)",
    run: () =>
      prisma.user.findFirst({
        where: { role: "CUSTOMER" },
        include: { addresses: { take: 1 } },
      }),
  },
  {
    name: "provider.findFirst+location+user (D1)",
    run: () =>
      prisma.provider.findFirst({
        where: { isActive: true },
        include: { currentLocation: true, user: true },
      }),
  },
  {
    name: "service.findFirst (D1)",
    run: () => prisma.service.findFirst({ where: { isActive: true } }),
  },
  {
    name: "booking.findFirst (D2-D5)",
    run: () =>
      prisma.booking.findFirst({
        orderBy: { createdAt: "desc" },
        include: { payment: true, user: true, provider: { include: { user: true } } },
      }),
  },
  {
    name: "payment.findFirst (payment path)",
    run: () => prisma.payment.findFirst({ orderBy: { createdAt: "desc" } }),
  },
  {
    name: "walletTransaction.findFirst (wallet path)",
    run: () => prisma.walletTransaction.findFirst({ orderBy: { createdAt: "desc" } }),
  },
  {
    name: "assignmentJob.findFirst (D3)",
    run: () =>
      prisma.assignmentJob.findFirst({
        include: { attempts: { take: 1 } },
      }),
  },
  {
    name: "eventOutbox.findFirst (D8)",
    run: () => prisma.eventOutbox.findFirst({ orderBy: { createdAt: "desc" } }),
  },
  {
    name: "walletTransfer.findFirst (transfer service model)",
    run: () => prisma.walletTransfer.findFirst({ orderBy: { createdAt: "desc" } }),
  },
];

async function main() {
  console.log("=== Stage D Wave-1 Prisma Critical-Path Probe ===");
  let pass = 0;
  let fail = 0;

  for (const probe of probes) {
    try {
      await probe.run();
      console.log(`PASS  ${probe.name}`);
      pass++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = (e as { code?: string })?.code ?? "UNKNOWN";
      console.log(`FAIL  ${probe.name}  [${code}] ${msg}`);
      fail++;
    }
  }

  console.log(`\nResult: ${pass} pass, ${fail} fail`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main();
