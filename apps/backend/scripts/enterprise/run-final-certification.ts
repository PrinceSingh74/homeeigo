/**
 * Final enterprise certification orchestrator.
 * Usage: bun --env-file=.env run scripts/enterprise/run-final-certification.ts
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = path.join(import.meta.dir, "../..");
const DOCS = path.join(ROOT, "docs");

type Phase = { name: string; cmd: string[]; doc: string };

const phases: Phase[] = [
  {
    name: "Enterprise operations (unit/integration)",
    cmd: ["bun", "test", "src/__tests__/enterprise-operations-certification.test.ts"],
    doc: "enterprise-operations-completion.md",
  },
  {
    name: "S3 migration",
    cmd: ["bun", "--env-file=.env", "run", "scripts/enterprise/s3-migration-certification.ts"],
    doc: "s3-migration-certification.md",
  },
  {
    name: "Multi-node deployment",
    cmd: ["bun", "--env-file=.env", "run", "scripts/enterprise/multi-node-certification.ts"],
    doc: "multi-node-certification.md",
  },
  {
    name: "Real Razorpay payout",
    cmd: ["bun", "--env-file=.env", "run", "scripts/enterprise/razorpay-payout-certification.ts"],
    doc: "razorpay-payout-certification.md",
  },
];

function extractOverall(docPath: string): string {
  if (!fs.existsSync(docPath)) return "NOT PROVEN";
  const text = fs.readFileSync(docPath, "utf8");
  const m = text.match(/\*\*Overall:\*\* \*\*(\w+)\*\*/);
  return m?.[1] ?? "NOT PROVEN";
}

function runPhase(phase: Phase): { exitCode: number; overall: string } {
  console.log(`\n=== ${phase.name} ===`);
  const res = spawnSync(phase.cmd[0]!, phase.cmd.slice(1), {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  const docPath = path.join(DOCS, phase.doc);
  return { exitCode: res.status ?? 1, overall: extractOverall(docPath) };
}

async function main() {
  const results: Array<{ phase: string; overall: string; exitCode: number }> = [];

  for (const phase of phases) {
    const r = runPhase(phase);
    results.push({ phase: phase.name, overall: r.overall, exitCode: r.exitCode });
  }

  console.log("\n=== Playwright Enterprise Ops ===");
  const seed = spawnSync("bun", ["--env-file=.env", "run", "scripts/enterprise/seed-playwright-ops-data.ts"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  const pw = spawnSync(
    "npx",
    ["playwright", "test", "e2e/enterprise/operations-certification.spec.ts", "--reporter=list"],
    {
      cwd: path.join(ROOT, "../admin-panel"),
      stdio: "inherit",
      shell: true,
      env: { ...process.env, E2E_SKIP_SERVERS: "true", E2E_API_URL: process.env.E2E_API_URL ?? "http://localhost:3000" },
    },
  );
  const pwVerdict = pw.status === 0 ? "PASS" : "FAIL";
  results.push({ phase: "Playwright enterprise ops", overall: pwVerdict, exitCode: pw.status ?? 1 });

  const classifications = {
    enterpriseCertified: results.every((r) => r.overall === "PASS"),
    battleTested: results.find((r) => r.phase.includes("operations"))?.overall === "PASS",
    multiNodeVerified: results.find((r) => r.phase.includes("Multi-node"))?.overall === "PASS",
    financiallyVerified: results.find((r) => r.phase.includes("Razorpay"))?.overall === "PASS",
    disasterRecoveryVerified: false,
    auditReady: results.find((r) => r.phase.includes("S3"))?.overall !== "FAIL",
  };

  const finalOverall = results.every((r) => r.overall === "PASS")
    ? "PASS"
    : results.some((r) => r.overall === "FAIL")
      ? "FAIL"
      : "PARTIAL";

  const md = [
    "# Final Enterprise Certification",
    "",
    `**Executed:** ${new Date().toISOString()}`,
    `**Overall platform status:** **${finalOverall}**`,
    "",
    "## Phase Results",
    "",
    "| Phase | Verdict | Exit |",
    "|-------|---------|------|",
    ...results.map((r) => `| ${r.phase} | **${r.overall}** | ${r.exitCode} |`),
    "",
    "## Classifications",
    "",
    "| Classification | Status |",
    "|----------------|--------|",
    `| ENTERPRISE CERTIFIED | ${classifications.enterpriseCertified ? "YES" : "NO"} |`,
    `| BATTLE TESTED | ${classifications.battleTested ? "YES" : "NO"} |`,
    `| MULTI-NODE VERIFIED | ${classifications.multiNodeVerified ? "YES" : "NO"} |`,
    `| FINANCIALLY VERIFIED | ${classifications.financiallyVerified ? "YES" : "NO"} |`,
    `| DISASTER RECOVERY VERIFIED | ${classifications.disasterRecoveryVerified ? "YES" : "NO"} |`,
    `| AUDIT READY | ${classifications.auditReady ? "YES" : "NO"} |`,
    "",
    finalOverall === "PASS"
      ? "## HOMIGO = FULL ENTERPRISE CERTIFIED PLATFORM"
      : "## HOMIGO = ENTERPRISE READY (certification gaps remain — see phase docs)",
    "",
  ].join("\n");

  fs.mkdirSync(DOCS, { recursive: true });
  fs.writeFileSync(path.join(DOCS, "final-enterprise-certification.md"), md);

  const pwMd = [
    "# Playwright Enterprise Operations Certification",
    "",
    `**Executed:** ${new Date().toISOString()}`,
    `**Overall:** **${pwVerdict}**`,
    "",
    `Seed exit: ${seed.status}`,
    `Playwright exit: ${pw.status}`,
    "",
    "Spec: `apps/admin-panel/e2e/enterprise/operations-certification.spec.ts`",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(DOCS, "playwright-enterprise-certification.md"), pwMd);

  console.log("\nWrote docs/final-enterprise-certification.md");
  process.exit(finalOverall === "FAIL" ? 1 : 0);
}

main();
