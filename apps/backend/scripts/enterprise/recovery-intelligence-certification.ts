/**
 * Recovery Intelligence certification — backup health, DR, RPO/RTO, simulator.
 * Run: bun --env-file=.env run scripts/enterprise/recovery-intelligence-certification.ts
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { recoveryIntelligenceService } from "../../src/services/recovery-intelligence.service";

const DOCS = join(import.meta.dir, "../../../admin-panel/docs/v6");

async function main() {
  if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });

  const status = await recoveryIntelligenceService.getStatus();
  const sim = recoveryIntelligenceService.simulate("database");
  const blockers: string[] = [];

  if (!status.backup) blockers.push("backup section missing");
  if (!status.disasterRecovery) blockers.push("disasterRecovery section missing");
  if (sim.destructive) blockers.push("Simulator must be non-destructive");
  if (!Array.isArray(sim.steps) || sim.steps.length === 0) blockers.push("Simulator returned no steps");

  const verdict = blockers.length === 0 ? "PASS" : "FAIL";
  const backupState = status.backup.health === "unknown" ? "NO_BACKUP_EVIDENCE" : status.backup.health.toUpperCase();

  const md = `# Recovery Intelligence Certification — HOMIGO V6

Generated: ${new Date().toISOString()}
Data policy: backup-metrics.json + homigo_*.dump inventory + restore-validation-report.json. No synthetic health scores.

## Verdict: **${verdict}**

${blockers.length ? `### Blockers\n${blockers.map((b) => `- ${b}`).join("\n")}` : "All gates passed."}

## Backup Health Center
| Field | Value |
|---|---|
| Health | ${status.backup.health} (${backupState}) |
| Total backups | ${status.backup.totalBackups} |
| Last success | ${status.backup.lastSuccessAt ?? "—"} |
| Size (bytes) | ${status.backup.sizeBytes} |
| Success rate % | ${status.backup.successRatePct ?? "—"} |
| Retention deleted | ${status.backup.retentionDeleted} |
| Backup dir | \`${status.backup.backupDir}\` |

## Disaster Recovery Center
| Field | Value |
|---|---|
| Readiness score | ${status.disasterRecovery.readinessScore}/100 |
| RTO target (sec) | ${status.disasterRecovery.rtoTargetSeconds} |
| RTO last drill (sec) | ${status.disasterRecovery.rtoLastDrillSeconds ?? "—"} |
| RPO target (sec) | ${status.disasterRecovery.rpoTargetSeconds} |
| RPO current (sec) | ${status.disasterRecovery.rpoCurrentSeconds ?? "—"} |
| Last restore validation | ${status.disasterRecovery.lastRestoreValidation ?? "—"} |

## Recovery Simulator (non-destructive)
Target: \`${sim.target}\`
Destructive: ${sim.destructive}
Estimated RTO: ${sim.estimatedRtoSeconds}s · RPO: ${sim.estimatedRpoSeconds}s

Steps:
${sim.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

## Endpoints
- \`GET /api/admin/recovery/status\`
- \`POST /api/admin/recovery/simulate\` — body: \`{ "target": "database" | "redis" | "queue" | "api" | "region" }\`

## Prometheus gauges
\`recovery_dr_readiness_score\`, \`recovery_backup_count\` (+ existing backup_* metrics on /metrics).
`;

  writeFileSync(join(DOCS, "recovery-intelligence-certification.md"), md);
  console.log(`Recovery Intelligence certification: ${verdict}`);
  console.log(`Backup=${status.backup.health} DR readiness=${status.disasterRecovery.readinessScore} Simulator steps=${sim.steps.length}`);
  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
