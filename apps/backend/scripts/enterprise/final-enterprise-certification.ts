/**
 * Final enterprise certification orchestrator — runtime evidence only.
 *
 *   bun --env-file=.env run scripts/enterprise/final-enterprise-certification.ts
 */
import "../../src/load-env";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ensureDir } from "../lib/safe-fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..", "..");
const REPO = join(BACKEND, "..", "..");
const OUT = join(REPO, "docs", "enterprise");
const REPORT = join(OUT, "ENTERPRISE_FINAL_CERTIFICATION.md");

type PhaseResult = { phase: string; verdict: "PASS" | "PARTIAL" | "FAIL"; evidence: string; command: string };

function runScript(script: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--env-file=.env", "run", script], {
      cwd: BACKEND,
      env: process.env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      process.stdout.write(s);
    });
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      process.stderr.write(s);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function readJsonVerdict(path: string): Promise<{ verdict?: string } | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  await ensureDir(OUT);
  const results: PhaseResult[] = [];

  const phases: Array<{ name: string; script: string; evidence: string }> = [
    { name: "Auth Bootstrap", script: "scripts/enterprise/auth-bootstrap-certification.ts", evidence: "auth-bootstrap-evidence.json" },
    { name: "Metrics", script: "scripts/enterprise/metrics-certification.ts", evidence: "metrics-certification-evidence.json" },
    { name: "Backup", script: "scripts/backup-enterprise-certification.ts", evidence: "backup-enterprise-certification.md" },
    { name: "Ecosystem", script: "scripts/ecosystem-enterprise-certification.ts", evidence: "homigo-mobile/.certification-evidence/ecosystem-enterprise.json" },
  ];

  for (const p of phases) {
    console.log(`\n=== Phase: ${p.name} ===\n`);
    const cmd = `bun --env-file=.env run ${p.script}`;
    const r = await runScript(p.script);
    const json = await readJsonVerdict(join(OUT, p.evidence));
    let verdict: PhaseResult["verdict"] = r.code === 0 ? "PASS" : "FAIL";
    if (json?.verdict === "PARTIAL") verdict = "PARTIAL";
    results.push({
      phase: p.name,
      verdict,
      evidence: p.evidence,
      command: cmd,
    });
  }

  const allPass = results.every((r) => r.verdict === "PASS");
  const anyFail = results.some((r) => r.verdict === "FAIL");
  const finalVerdict = allPass ? "PRODUCTION READY" : anyFail ? "NOT PRODUCTION READY" : "CONDITIONAL — review PARTIAL phases";

  const lines = [
    "# HOMIGO Enterprise Final Certification",
    "",
    `**Generated:** ${new Date().toISOString()}`,
    `**Final Verdict:** **${finalVerdict}**`,
    "",
    "## Phase results",
    "",
    "| Phase | Verdict | Evidence | Command |",
    "|-------|---------|----------|---------|",
    ...results.map(
      (r) => `| ${r.phase} | **${r.verdict}** | \`${r.evidence}\` | \`${r.command}\` |`,
    ),
    "",
    "## Infrastructure status",
    "",
    "| Component | Status |",
    "|-----------|--------|",
    `| Auth Bootstrap | ${results.find((r) => r.phase === "Auth Bootstrap")?.verdict ?? "?"} |`,
    `| Metrics / Prometheus | ${results.find((r) => r.phase === "Metrics")?.verdict ?? "?"} |`,
    `| Backup / GFS Retention | ${results.find((r) => r.phase === "Backup")?.verdict ?? "?"} |`,
    `| Ecosystem | ${results.find((r) => r.phase === "Ecosystem")?.verdict ?? "?"} |`,
    "",
    "## Justification",
    "",
    allPass
      ? "All certification phases passed with runtime evidence. No blocking gaps remain."
      : anyFail
        ? "One or more phases failed — see evidence JSON/MD files in `docs/enterprise/`."
        : "Some phases partial — production deployment possible with documented caveats.",
    "",
    "## Evidence files",
    "",
    "- `docs/enterprise/auth-bootstrap-evidence.json`",
    "- `docs/enterprise/metrics-certification-evidence.json`",
    "- `docs/enterprise/backup-enterprise-certification.md`",
    "- `homigo-mobile/.certification-evidence/ecosystem-enterprise.json`",
    "",
  ];

  await writeFile(REPORT, lines.join("\n"));
  console.log(`\n[final-cert] report → ${REPORT}`);
  console.log(`[final-cert] ${finalVerdict}`);
  if (!allPass) process.exit(anyFail ? 1 : 2);
}

main().catch((e) => {
  console.error("[final-cert] fatal:", e);
  process.exit(1);
});
