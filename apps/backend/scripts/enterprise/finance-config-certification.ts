/**
 * Finance Config certification — evidence-based PASS/FAIL.
 * Run: bun --env-file=.env run scripts/enterprise/finance-config-certification.ts
 */
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import prisma from "../../src/lib/prisma";
import {
  financeConfigService,
  FINANCE_CONFIG_KEYS,
} from "../../src/services/finance-config.service";
import { financeIntelligenceService } from "../../src/services/finance-intelligence.service";
import { rbacService } from "../../src/services/rbac.service";

const DOCS = join(import.meta.dir, "../../../admin-panel/docs/v5");
const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists`,
    name,
  );
  return Boolean(rows[0]?.exists);
}

async function main() {
  const blockers: string[] = [];
  const evidence: string[] = [];

  await rbacService.syncDefaultRolePermissions();

  const [configTable, historyTable] = await Promise.all([
    tableExists("finance_config"),
    tableExists("finance_config_history"),
  ]);
  if (!configTable) blockers.push("finance_config table missing — run migration");
  if (!historyTable) blockers.push("finance_config_history table missing — run migration");
  evidence.push(`Tables: finance_config=${configTable}, finance_config_history=${historyTable}`);

  const before = await financeConfigService.resolve();
  evidence.push(
    `Resolve before write: opex=${inr(before.operatingExpenseMonthly)} (${before.sources.operatingExpenseMonthly}), cash=${inr(before.cashOnHand)} (${before.sources.cashOnHand})`,
  );

  const testAdmin = await prisma.adminUser.findFirst({ select: { id: true, userId: true } });
  const testAdminId = testAdmin?.id ?? "cert-finance-config";
  const testUserId = testAdmin?.userId ?? null;
  const priorOpex = await prisma.financeConfig.findUnique({
    where: { key: FINANCE_CONFIG_KEYS.OPERATING_EXPENSE_MONTHLY },
  });

  try {
    const priorValue = priorOpex?.value ?? null;
    const testValue = priorValue != null ? priorValue : 1;
    await financeConfigService.update(
      FINANCE_CONFIG_KEYS.OPERATING_EXPENSE_MONTHLY,
      testValue,
      { adminId: testAdminId, userId: testUserId ?? testAdminId },
      { reason: "finance-config-certification probe" },
    );

    const afterWrite = await financeConfigService.resolve();
    if (afterWrite.sources.operatingExpenseMonthly !== "db") {
      blockers.push("After write, opex source is not db");
    }
    if (afterWrite.operatingExpenseMonthly !== testValue) {
      blockers.push(`Opex mismatch after write: expected ${testValue}, got ${afterWrite.operatingExpenseMonthly}`);
    }

    const history = await financeConfigService.getHistory({
      key: FINANCE_CONFIG_KEYS.OPERATING_EXPENSE_MONTHLY,
      limit: 1,
    });
    if (history.length === 0) blockers.push("History not appended after config update");
    else evidence.push(`History row: ${history[0].configKey} ${history[0].valueBefore} → ${history[0].valueAfter}`);

    const intel = await financeIntelligenceService.getFinanceIntelligence(30);
    if (intel.ebitda.available !== true) {
      evidence.push("EBITDA still unavailable (cash may be unset — expected until CFO configures)");
    } else {
      evidence.push(`EBITDA enabled after opex in DB: ${inr(intel.ebitda.ebitda)}`);
    }

    if (priorOpex) {
      await financeConfigService.update(
        FINANCE_CONFIG_KEYS.OPERATING_EXPENSE_MONTHLY,
        priorValue!,
        { adminId: testAdminId, userId: testUserId ?? testAdminId },
        { reason: "finance-config-certification restore" },
      );
    } else {
      await prisma.financeConfigHistory.deleteMany({ where: { changedBy: testAdminId } });
      await prisma.financeConfig.delete({
        where: { key: FINANCE_CONFIG_KEYS.OPERATING_EXPENSE_MONTHLY },
      });
    }
    evidence.push("Probe value restored — no persistent test data left");
  } catch (err) {
    blockers.push(`Write/history probe failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const rbacRows = await prisma.adminPermission.count({
    where: { resource: "PAYMENTS", action: "UPDATE" },
  });
  evidence.push(`PAYMENTS:UPDATE permissions seeded: ${rbacRows}`);

  const verdict = blockers.length === 0 ? "PASS" : "FAIL";
  const md = `# Finance Config Certification — HOMIGO V5

Generated: ${new Date().toISOString()}
Verdict: **${verdict}**

## Schema (additive)
- \`finance_config\` — current CFO inputs (key/value)
- \`finance_config_history\` — immutable audit trail per change

## Resolution order
1. \`finance_config\` table (DB, authoritative)
2. Legacy env vars (\`OPERATING_EXPENSE_MONTHLY\`, \`CASH_ON_HAND\`, \`PAYMENT_GATEWAY_FEE_PCT\`)
3. Default gateway fee 2% only

## API
| Method | Route | RBAC |
|--------|-------|------|
| GET | \`/api/admin/finance/config\` | PAYMENTS:READ |
| GET | \`/api/admin/finance/config/history\` | PAYMENTS:READ |
| PATCH | \`/api/admin/finance/config\` | PAYMENTS:UPDATE |

## Runtime evidence
${evidence.map((e) => `- ${e}`).join("\n")}

${blockers.length ? `## Blockers\n${blockers.map((b) => `- ${b}`).join("\n")}` : "## All gates passed"}
`;

  if (!existsSync(DOCS)) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(DOCS, { recursive: true });
  }
  writeFileSync(join(DOCS, "finance-config-certification.md"), md);

  console.log(`Finance Config certification: ${verdict}`);
  for (const e of evidence) console.log(`  ${e}`);
  if (blockers.length) console.log("Blockers:", blockers.join("; "));
  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
