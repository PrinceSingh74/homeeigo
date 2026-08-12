/**
 * CTO Production Readiness Audit — execution evidence collector.
 * Run: bun run scripts/cto-production-readiness-audit.ts
 */
import "../src/load-env";
import { Prisma } from "@prisma/client";
import { prisma, dbReachable } from "../src/__tests__/helpers/adversarial-fixtures";
import { financialIntegrityService } from "../src/services/financial-integrity.service";
import { observabilityService } from "../src/services/observability.service";

type Finding = {
  phase: string;
  id: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  status: "FIXED" | "PARTIALLY FIXED" | "NOT FIXED" | "UNVERIFIED";
  title: string;
  rootCause: string;
  reproduction: string[];
  evidence: unknown;
  fix: string;
  rollback: string;
};

const findings: Finding[] = [];

function add(f: Finding) {
  findings.push(f);
  console.log(`\n[${f.phase}] ${f.id} — ${f.status} (${f.severity})`);
  console.log(`  ${f.title}`);
  console.log(`  Evidence: ${JSON.stringify(f.evidence)}`);
}

function simulateFloatDrift(iterations: number) {
  let wallet = 0;
  let ledger = 0;
  let maxDrift = 0;
  const increment = 0.1;
  for (let i = 0; i < iterations; i++) {
    wallet += increment;
    ledger = Math.round((ledger + increment) * 100) / 100;
    const drift = Math.abs(wallet - ledger);
    if (drift > maxDrift) maxDrift = drift;
  }
  return { iterations, maxDrift, finalWallet: wallet, finalLedger: ledger, terminalDrift: Math.abs(wallet - ledger) };
}

function simulateLakhTransactions() {
  const OPS = 100_000;
  let balance = 0;
  let maxDrift = 0;
  const amounts = [0.1, 0.2, 0.3, 7.77, 99.99, 1000.01];
  for (let i = 0; i < OPS; i++) {
    const amt = amounts[i % amounts.length]!;
    balance += amt;
    const rounded = Math.round(balance * 100) / 100;
    const drift = Math.abs(balance - rounded);
    if (drift > maxDrift) maxDrift = drift;
  }
  return { ops: OPS, maxDrift, terminalBalance: balance, roundedBalance: Math.round(balance * 100) / 100 };
}

async function main() {
  console.log("=".repeat(80));
  console.log("HOMIGO CTO PRODUCTION READINESS AUDIT");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log("=".repeat(80));

  const dbOk = await dbReachable();
  if (!dbOk) {
    add({
      phase: "INFRA",
      id: "DB-UNREACHABLE",
      severity: "CRITICAL",
      status: "UNVERIFIED",
      title: "PostgreSQL unreachable — DB-dependent phases skipped",
      rootCause: "DATABASE_URL auth/connection failure in audit environment",
      reproduction: ["bun run scripts/cto-production-readiness-audit.ts"],
      evidence: { dbOk: false },
      fix: "Ensure DATABASE_URL credentials valid for audit host",
      rollback: "N/A",
    });
  } else {
    try {
      const integrity = await financialIntegrityService.validate();
      add({
        phase: "PHASE-1",
        id: "FIN-INTEGRITY",
        severity: integrity.bySeverity.critical > 0 ? "CRITICAL" : integrity.bySeverity.warning > 0 ? "HIGH" : "LOW",
        status:
          integrity.bySeverity.critical > 0
            ? "NOT FIXED"
            : integrity.score >= 90
              ? "FIXED"
              : "PARTIALLY FIXED",
        title: "Financial integrity validator",
        rootCause:
          integrity.bySeverity.critical > 0
            ? "Active CRITICAL integrity violations in database"
            : "No critical violations at audit time",
        reproduction: ["financialIntegrityService.validate()"],
        evidence: {
          score: integrity.score,
          status: integrity.status,
          critical: integrity.bySeverity.critical,
          warning: integrity.bySeverity.warning,
          issueCount: integrity.issues.length,
          topIssues: integrity.issues.slice(0, 5).map((i) => `${i.category}: ${i.details}`),
        },
        fix: integrity.bySeverity.critical > 0 ? "Remediate listed integrity issues + re-run validator" : "Continue scheduled integrity runs",
        rollback: "N/A",
      });
    } catch (e) {
      add({
        phase: "PHASE-1",
        id: "FIN-INTEGRITY-ERR",
        severity: "HIGH",
        status: "UNVERIFIED",
        title: "Financial integrity validator threw",
        rootCause: e instanceof Error ? e.message : String(e),
        reproduction: ["financialIntegrityService.validate()"],
        evidence: { error: e instanceof Error ? e.message : String(e) },
        fix: "Investigate validator failure",
        rollback: "N/A",
      });
    }

    try {
      const dash = await observabilityService.getHealthDashboard();
      add({
        phase: "PHASE-8",
        id: "OBS-DASHBOARD",
        severity: "LOW",
        status: "FIXED",
        title: "Observability health dashboard reachable",
        rootCause: "N/A",
        reproduction: ["observabilityService.getHealthDashboard()"],
        evidence: {
          database: dash.serviceHealth.database.status,
          redis: dash.serviceHealth.redis.status,
          paymentsPending: dash.serviceHealth.payments.pending,
          walletPending: dash.serviceHealth.wallet?.pendingTopups,
          walletStale: dash.serviceHealth.wallet?.stalePendingTopups,
          financeStatus: dash.serviceHealth.finance.status,
        },
        fix: "N/A",
        rollback: "N/A",
      });
    } catch (e) {
      add({
        phase: "PHASE-8",
        id: "OBS-DASHBOARD-ERR",
        severity: "MEDIUM",
        status: "PARTIALLY FIXED",
        title: "Observability dashboard error",
        rootCause: e instanceof Error ? e.message : String(e),
        reproduction: ["observabilityService.getHealthDashboard()"],
        evidence: { error: e instanceof Error ? e.message : String(e) },
        fix: "Fix observability dependencies (Redis/DB)",
        rollback: "N/A",
      });
    }

    const floatFields = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type = 'double precision'
        AND (
          column_name LIKE '%amount%'
          OR column_name LIKE '%balance%'
          OR column_name LIKE '%commission%'
          OR column_name LIKE '%price%'
          OR column_name LIKE '%refund%'
        )
      ORDER BY table_name, column_name
    `;
    add({
      phase: "PHASE-2",
      id: "DECIMAL-FLOAT-SCHEMA",
      severity: "HIGH",
      status: "NOT FIXED",
      title: "Financial columns stored as PostgreSQL double precision (Float)",
      rootCause: "Prisma schema uses Float for money fields — IEEE-754 accumulation risk",
      reproduction: ["SELECT data_type FROM information_schema.columns WHERE data_type='double precision'"],
      evidence: { floatMoneyColumnCount: floatFields.length, sample: floatFields.slice(0, 15) },
      fix: "Migrate money columns to NUMERIC(19,4) / Prisma Decimal; dual-write + reconciliation pass",
      rollback: "Keep Float columns; add application-layer Decimal only (partial mitigation)",
    });
  }

  const drift100k = simulateLakhTransactions();
  const driftFloat = simulateFloatDrift(100_000);
  add({
    phase: "PHASE-2",
    id: "DECIMAL-DRIFT-SIM",
    severity: driftFloat.maxDrift > 0.01 ? "HIGH" : "MEDIUM",
    status: "PARTIALLY FIXED",
    title: "Float drift simulation (100k ops)",
    rootCause: "Native JS float accumulation without Decimal type",
    reproduction: ["100k incremental wallet ops with Math.round mitigation"],
    evidence: { lakh: drift100k, floatAccumulation: driftFloat },
    fix: "Prisma Decimal + integer paise storage for ledger; Math.round is mitigation not guarantee",
    rollback: "Continue Math.round(×100)/100 pattern",
  });

  const summary = {
    timestamp: new Date().toISOString(),
    dbReachable: dbOk,
    findingCount: findings.length,
    byStatus: {
      FIXED: findings.filter((f) => f.status === "FIXED").length,
      "PARTIALLY FIXED": findings.filter((f) => f.status === "PARTIALLY FIXED").length,
      "NOT FIXED": findings.filter((f) => f.status === "NOT FIXED").length,
      UNVERIFIED: findings.filter((f) => f.status === "UNVERIFIED").length,
    },
    findings,
  };

  console.log("\n" + "=".repeat(80));
  console.log("AUDIT SUMMARY");
  console.log(JSON.stringify(summary.byStatus, null, 2));
  console.log("=".repeat(80));

  await prisma.$disconnect();
  process.exit(findings.some((f) => f.status === "NOT FIXED" && f.severity === "CRITICAL") ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
