/**
 * Platform Intelligence certification — feature flags, rollouts, experiments, kill switches.
 * Run: bun --env-file=.env run scripts/enterprise/platform-intelligence-certification.ts
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { platformIntelligenceService } from "../../src/services/platform-intelligence.service";

const DOCS = join(import.meta.dir, "../../../admin-panel/docs/v6");

async function main() {
  if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });

  const data = await platformIntelligenceService.getIntelligence();
  const blockers: string[] = [];

  if (!Array.isArray(data.featureFlags)) blockers.push("featureFlags not an array");
  if (!Array.isArray(data.experiments)) blockers.push("experiments not an array");
  if (!Array.isArray(data.killSwitches)) blockers.push("killSwitches not an array");
  if (data.experiments.length === 0) blockers.push("No experiments registered (expected surge_v1 at minimum)");

  const verdict = blockers.length === 0 ? "PASS" : "FAIL";

  const md = `# Platform Intelligence Certification — HOMIGO V6

Generated: ${new Date().toISOString()}
Data policy: platform_feature_flags + platform_experiments tables; live pricing A/B (surge_v1) merged when not in DB.

## Verdict: **${verdict}**

${blockers.length ? `### Blockers\n${blockers.map((b) => `- ${b}`).join("\n")}` : "All gates passed."}

## Summary
| Field | Value |
|---|---|
| Feature flags | ${data.flagCount} |
| Enabled flags | ${data.enabledFlags} |
| Kill switches | ${data.killSwitches.length} |
| Experiments | ${data.experiments.length} |

## Feature flags
${data.featureFlags.length ? data.featureFlags.map((f) => `- **${f.key}**: ${f.enabled ? "ON" : "OFF"} rollout ${f.rolloutPct}%${f.isKillSwitch ? " [KILL SWITCH]" : ""}`).join("\n") : "_No flags configured yet — use PATCH /api/admin/platform/flags to register._"}

## Experiments
${data.experiments.map((e) => `- **${e.key}** (${e.status})${"source" in e ? ` [${(e as { source?: string }).source}]` : ""}`).join("\n")}

## Prometheus experiment metrics (pricing engine)
${data.experimentMetrics.map((m) => `- \`${m}\``).join("\n")}

## Endpoints
- \`GET /api/admin/platform/intelligence\`
- \`PATCH /api/admin/platform/flags\` — upsert flag / rollout / kill switch

## Prometheus gauges
\`platform_flags_total\`, \`platform_flags_enabled\`, \`platform_experiments_running\`.
`;

  writeFileSync(join(DOCS, "platform-intelligence-certification.md"), md);
  console.log(`Platform Intelligence certification: ${verdict}`);
  console.log(`Flags=${data.flagCount} Experiments=${data.experiments.length} KillSwitches=${data.killSwitches.length}`);
  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
