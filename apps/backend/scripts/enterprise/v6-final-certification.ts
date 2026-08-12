/**
 * HOMIGO Enterprise OS V6 — final certification orchestrator.
 * Run: bun --env-file=.env run scripts/enterprise/v6-final-certification.ts
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const DOCS = join(import.meta.dir, "../../../admin-panel/docs/v6");
const BACKEND = join(import.meta.dir, "../..");

const CERTS = [
  { name: "Customer Intelligence", script: "scripts/enterprise/customer-intelligence-certification.ts", doc: "customer-intelligence-certification.md" },
  { name: "Growth Intelligence", script: "scripts/enterprise/growth-intelligence-certification.ts", doc: "growth-intelligence-certification.md" },
  { name: "Risk Intelligence", script: "scripts/enterprise/risk-intelligence-certification.ts", doc: "risk-intelligence-certification.md" },
  { name: "Platform Intelligence", script: "scripts/enterprise/platform-intelligence-certification.ts", doc: "platform-intelligence-certification.md" },
  { name: "Recovery Intelligence", script: "scripts/enterprise/recovery-intelligence-certification.ts", doc: "recovery-intelligence-certification.md" },
] as const;

function run(script: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--env-file=.env", "run", script], {
      cwd: BACKEND,
      env: process.env,
      stdio: "inherit",
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function extractVerdict(md: string): string {
  const m = md.match(/## Verdict: \*\*(PASS|FAIL)\*\*/);
  return m?.[1] ?? "UNKNOWN";
}

async function main() {
  if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });

  const results: Array<{ name: string; verdict: string; doc: string }> = [];

  for (const cert of CERTS) {
    console.log(`\n── ${cert.name} ──`);
    const code = await run(cert.script);
    const docPath = join(DOCS, cert.doc);
    const md = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";
    const verdict = code === 0 ? extractVerdict(md) : "FAIL";
    results.push({ name: cert.name, verdict: verdict === "PASS" ? "PASS" : "FAIL", doc: cert.doc });
  }

  const allPass = results.every((r) => r.verdict === "PASS");
  const verdict = allPass ? "PASS" : "FAIL";

  const md = `# HOMIGO Enterprise OS V6 — Final Certification

Generated: ${new Date().toISOString()}
Scope: Customer, Growth, Risk, Platform, Recovery intelligence layers
Policy: additive APIs only · real data · Prometheus metrics · Executive HQ integration

## Overall Verdict: **${verdict}**

| Layer | Verdict | Report |
|---|---|---|
${results.map((r) => `| ${r.name} | **${r.verdict}** | [${r.doc}](./${r.doc}) |`).join("\n")}

## V6 API surface (additive)
| Endpoint | Layer |
|---|---|
| \`GET /api/admin/cx/intelligence\` | Customer |
| \`GET /api/admin/growth/intelligence\` | Growth |
| \`GET /api/admin/risk/intelligence\` | Risk |
| \`GET /api/admin/platform/intelligence\` | Platform |
| \`PATCH /api/admin/platform/flags\` | Platform |
| \`GET /api/admin/recovery/status\` | Recovery |
| \`POST /api/admin/recovery/simulate\` | Recovery |

## Prometheus gauges (V6)
**Customer:** \`cx_nps_score\`, \`cx_csat_pct\`, \`cx_happiness_score\`, \`cx_service_satisfaction_index\`
**Growth:** \`growth_cac_inr\`, \`growth_ltv_inr\`, \`growth_ltv_cac_ratio\`, \`growth_roas\`, \`growth_payback_months\`
**Risk:** \`risk_unified_trust_score\`, \`risk_fraud_confidence\`, \`risk_payment_risk_score\`, \`risk_compliance_risk_score\`
**Platform:** \`platform_flags_total\`, \`platform_flags_enabled\`, \`platform_experiments_running\`
**Recovery:** \`recovery_dr_readiness_score\`, \`recovery_backup_count\`

## Certification commands
\`\`\`bash
npm run cert:customer-intelligence
npm run cert:growth-intelligence
npm run cert:risk-intelligence
npm run cert:platform-intelligence
npm run cert:recovery-intelligence
npm run cert:v6-final
\`\`\`

## Finance Intelligence (V5 prerequisite — unchanged)
Finance HQ remains certified via \`cert:finance-intelligence\` and \`cert:finance-config\`.
`;

  writeFileSync(join(DOCS, "HOMIGO_V6_FINAL_CERTIFICATION.md"), md);
  console.log(`\nHOMIGO V6 Final Certification: ${verdict}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
