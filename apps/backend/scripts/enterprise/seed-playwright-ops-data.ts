/**
 * Seeds deterministic ops data for Playwright enterprise certification.
 * Usage: bun --env-file=.env run scripts/enterprise/seed-playwright-ops-data.ts
 */
import "../../src/load-env";
import { ChargebackStatus, SettlementDiscrepancyType, SettlementSyncStatus, WithdrawalStatus } from "@prisma/client";
import { PrismaClient } from "@prisma/client";
import prisma from "../../src/lib/prisma";
import { resolvePrismaDatasourceUrl } from "../../src/lib/database-url";
import { normalizeEmail, normalizePhone } from "../../src/lib/pii-normalize";
import { PasswordService } from "../../src/services/password.service";
import { userPiiService } from "../../src/services/user-pii.service";
import fs from "fs";
import path from "path";

const rawPrisma = new PrismaClient({
  datasources: { db: { url: resolvePrismaDatasourceUrl() } },
});

const RUN_ID = "pw-ops-seed";
const OUT = path.join(import.meta.dir, "../../../admin-panel/e2e/enterprise/ops-seed.json");

async function main() {
  const admin = await prisma.user.findFirst({ where: { email: "admin@homigo.demo" } });
  if (!admin) throw new Error("admin@homigo.demo not found — run db:seed");

  const provider = await prisma.provider.findFirst({ include: { user: true } });
  if (!provider) throw new Error("No provider — run db:seed");

  let withdrawal = await prisma.withdrawal.findFirst({
    where: { status: WithdrawalStatus.REQUESTED, providerId: provider.id },
  });
  if (!withdrawal) {
    withdrawal = await prisma.withdrawal.create({
      data: {
        providerId: provider.id,
        amount: 500,
        netAmount: 490,
        processingFee: 10,
        status: WithdrawalStatus.REQUESTED,
        withdrawalNumber: `PW-${Date.now()}`,
        accountHolderName: provider.businessName ?? "Demo Provider",
        accountNumber: provider.bankAccountNumber ?? "1234567890",
        ifscCode: provider.bankIfscCode ?? "HDFC0001234",
        bankName: provider.bankName ?? "HDFC",
        paymentMethod: "bank_transfer",
      },
    });
  }

  const financeRole = await prisma.adminRole.findFirst({ where: { name: "FINANCE_ADMIN" } });
  const approverEmail = "finance-approver@homigo.demo";
  const approverPhone = "+919900000099";
  const approverPassword = "Homigo@123";
  const approverHash = await PasswordService.hashPassword(approverPassword);
  const approverPii = {
    email: normalizeEmail(approverEmail),
    phoneNumber: normalizePhone(approverPhone),
    emailEncrypted: null,
    emailHash: null,
    phoneEncrypted: null,
    phoneHash: null,
    dataEncryptionStatus: "PARTIAL" as const,
  };

  let approver = await userPiiService.findByEmail(approverEmail);
  if (!approver) {
    approver = await rawPrisma.user.create({
      data: {
        ...approverPii,
        firstName: "Finance",
        lastName: "Approver",
        password: approverHash,
        role: "ADMIN",
        isEmailVerified: true,
        adminProfile: financeRole ? { create: { roleId: financeRole.id, grantedBy: admin.id } } : undefined,
      },
    });
  } else {
    approver = await rawPrisma.user.update({
      where: { id: approver.id },
      data: { password: approverHash, ...approverPii },
    });
    if (financeRole) {
      await rawPrisma.adminUser.upsert({
        where: { userId: approver.id },
        create: { userId: approver.id, roleId: financeRole.id, grantedBy: admin.id },
        update: { roleId: financeRole.id },
      });
    }
  }

  const linkedPayment = await prisma.payment.findFirst({
    where: { status: "SUCCESS", razorpayPaymentId: { not: null } },
    orderBy: { createdAt: "desc" },
  });

  const chargeback = await prisma.chargeback.create({
    data: {
      paymentId: linkedPayment?.id,
      razorpayPaymentId: linkedPayment?.razorpayPaymentId,
      amount: linkedPayment?.amountPaid ?? 999,
      amountPaise: linkedPayment?.amountPaidPaise ?? BigInt(99900),
      status: ChargebackStatus.RECEIVED,
      reason: `${RUN_ID} playwright dispute`,
      razorpayDisputeId: `pw-dispute-${Date.now()}`,
      metadata: linkedPayment
        ? JSON.stringify({ paymentId: linkedPayment.id, bookingId: linkedPayment.bookingId, source: RUN_ID })
        : undefined,
    },
  });

  const syncRun = await prisma.settlementSyncRun.create({
    data: { status: SettlementSyncStatus.COMPLETED, settlementsSynced: 1, discrepanciesFound: 1 },
  });

  const discrepancy = await prisma.settlementDiscrepancy.create({
    data: {
      syncRunId: syncRun.id,
      type: SettlementDiscrepancyType.AMOUNT_MISMATCH,
      expectedAmount: 1000,
      actualAmount: 950,
      referenceId: `pw-disc-${Date.now()}`,
      details: `${RUN_ID} playwright discrepancy`,
    },
  });

  const customer = await prisma.user.findFirst({ where: { role: "CUSTOMER", email: { contains: "customer" } } });
  const service = await prisma.service.findFirst({ where: { isActive: true } });
  const address = customer
    ? await prisma.address.findFirst({ where: { userId: customer.id } })
    : null;

  const payload = {
    adminId: admin.id,
    withdrawalId: withdrawal.id,
    chargebackId: chargeback.id,
    discrepancyId: discrepancy.id,
    providerId: provider.id,
    approverEmail,
    approverPassword,
    customerId: customer?.id ?? null,
    serviceId: service?.id ?? null,
    addressId: address?.id ?? null,
    seededAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log("✅ Playwright ops seed written:", OUT);
  console.log(JSON.stringify(payload, null, 2));
  await prisma.$disconnect();
  await rawPrisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
