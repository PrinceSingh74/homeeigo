/**
 * Phase 16 — §46 guard-removal proof.
 *
 * A passing test proves nothing on its own: it may be passing because the guard works, or because
 * the test never touched the guard. The only way to tell them apart is to break the guard on
 * purpose and confirm the test notices.
 *
 * For each control this script:
 *   1. asserts the probe PASSES with the guard intact
 *   2. edits the real source file to remove the guard
 *   3. asserts the probe now FAILS
 *   4. restores the file byte-for-byte
 *   5. asserts the probe PASSES again
 *
 * A guard whose removal changes nothing is reported as NOT_LOAD_BEARING, which is a finding, not
 * a pass. The restore runs in a `finally` and the script verifies the restored bytes match the
 * original hash — leaving a security control removed on disk because a probe threw would be a far
 * worse outcome than any defect this script can find.
 *
 * Each probe runs in a FRESH child process. Bun caches modules, so patching a file in the parent
 * process would have no effect on already-imported code and every "removal" would silently be a
 * no-op — the script would then report five load-bearing guards while having tested none of them.
 */
import "../../src/load-env";
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { resolve } from "path";

type Guard = {
  id: string;
  name: string;
  file: string;
  /** Exact source to remove or neuter. Must match once. */
  find: string;
  replace: string;
  /** A self-contained probe, run in a child process. Must exit 0 when the guard holds. */
  probe: string;
};

const ROOT = resolve(import.meta.dir, "../..");

const GUARDS: Guard[] = [
  {
    id: "GR1",
    name: "Cross-agent capability allowlist (plan validation)",
    file: "src/agents/planning/plan-validator.ts",
    find: `    const cap = getCapability(agentId, step.capability);
    if (!cap) {`,
    // Neutered by resolving an unknown capability to the agent's first one — the "helpful"
    // repair a well-meaning refactor might introduce, and the exact behaviour §6 forbids.
    replace: `    const cap = getCapability(agentId, step.capability) ?? getAgentDefinition(agentId).capabilities[0];
    if (!cap) {`,
    probe: `
      const { validatePlan } = await import("SRC/agents/planning/plan-validator.ts");
      const v = validatePlan("support", { goal: "g", reason: "r", steps: [
        { capability: "finance.reconciliation", arguments: {}, reason: "", expectedEffect: "" }] });
      // The guard holds only if the foreign capability is REJECTED.
      process.exit(!v.ok && v.code === "UNKNOWN_CAPABILITY" ? 0 : 1);
    `,
  },
  {
    id: "GR2",
    name: "Read-only agent write prohibition (step disposition)",
    file: "src/agents/policy/agent-policy.ts",
    find: `  if (def.readOnly && params.isWrite) {
    return { action: "ESCALATE", reason: "READ_ONLY_AGENT" };
  }`,
    replace: `  // guard removed for GR2`,
    probe: `
      const { disposeStep } = await import("SRC/agents/policy/agent-policy.ts");
      const d = disposeStep({ agentId: "finance", mode: "LIVE", stepRisk: "LOW", isWrite: true });
      process.exit(d.action === "ESCALATE" ? 0 : 1);
    `,
  },
  {
    id: "GR3",
    name: "High-risk always escalates to a human",
    file: "src/agents/policy/agent-policy.ts",
    find: `  if (params.stepRisk === "HIGH") {
    return { action: "ESCALATE", reason: "HIGH_RISK_REQUIRES_HUMAN" };
  }`,
    replace: `  // guard removed for GR3`,
    probe: `
      const { disposeStep } = await import("SRC/agents/policy/agent-policy.ts");
      const { AGENT_DEFINITIONS } = await import("SRC/agents/registry/agent-registry.ts");
      /**
       * The agent ceiling is raised to HIGH for this probe, deliberately.
       *
       * The first version used "support" unchanged and reported the guard NOT load-bearing —
       * because support has a MEDIUM ceiling, so the ceiling rule immediately below the HIGH
       * rule escalated the step anyway. That is real defence in depth, but it meant the probe
       * was measuring the ceiling rule while claiming to measure the HIGH rule.
       *
       * What the HIGH rule uniquely guarantees is that no CONFIGURATION can authorise autonomous
       * high-risk execution. So the probe creates exactly that configuration.
       */
      AGENT_DEFINITIONS.support.maxAutonomousRisk = "HIGH";
      const d = disposeStep({ agentId: "support", mode: "LIVE", stepRisk: "HIGH", isWrite: true });
      process.exit(d.action === "ESCALATE" ? 0 : 1);
    `,
  },
  {
    id: "GR4",
    name: "Undeclared argument rejection",
    file: "src/agents/planning/plan-validator.ts",
    find: `      if (!cap.allowedArguments.includes(name)) {`,
    // The classic wrong fix: drop the unknown argument instead of refusing the plan.
    replace: `      if (false && !cap.allowedArguments.includes(name)) {`,
    probe: `
      const { validatePlan } = await import("SRC/agents/planning/plan-validator.ts");
      const v = validatePlan("support", { goal: "g", reason: "r", steps: [
        { capability: "ticket.context", arguments: { ticketId: "x", injected: "yes" },
          reason: "", expectedEffect: "" }] });
      process.exit(!v.ok && v.code === "UNKNOWN_ARGUMENT" ? 0 : 1);
    `,
  },
  {
    id: "GR5",
    name: "Recursion cycle detection",
    file: "src/agents/policy/agent-policy.ts",
    find: `    if (parent.agentId === agentId) {`,
    replace: `    if (false && parent.agentId === agentId) {`,
    probe: `
      process.env.AGENTS_ENABLED = "true";
      const prisma = (await import("SRC/lib/prisma.ts")).default;
      const { admitAgentRun } = await import("SRC/agents/policy/agent-policy.ts");
      // A real parent row of the SAME agent is required for the cycle check to have anything
      // to find; a synthetic id would make the walk terminate on "parent not found" and the
      // probe would pass with the guard removed.
      const runId = "gr5-parent-" + Date.now();
      await prisma.agentRun.create({ data: {
        runId, agentId: "operations", agentVersion: "1.0.0", mode: "SHADOW", status: "COMPLETED",
        actorRole: "ADMIN", triggerType: "MANUAL", traceId: runId, depth: 0, goal: "gr5" } });
      const a = await admitAgentRun({ agentId: "operations",
        trigger: { type: "EVENT", ref: runId, parentRunId: runId, depth: 1 } });
      await prisma.agentRun.delete({ where: { runId } }).catch(() => {});
      await prisma.$disconnect();
      process.exit(!a.ok && a.code === "RECURSION_CYCLE_DETECTED" ? 0 : 1);
    `,
  },
  {
    id: "GR6",
    name: "Kill switch blocks new runs",
    file: "src/agents/policy/agent-policy.ts",
    find: `  if (agentsConfig.killSwitch) {
    return { ok: false, code: "KILL_SWITCH", reason: "AGENTS_KILL_SWITCH is engaged" };
  }`,
    replace: `  // guard removed for GR6`,
    probe: `
      process.env.AGENTS_ENABLED = "true";
      process.env.AGENTS_KILL_SWITCH = "true";
      const { admitAgentRun } = await import("SRC/agents/policy/agent-policy.ts");
      const a = await admitAgentRun({ agentId: "operations", trigger: { type: "MANUAL" } });
      const prisma = (await import("SRC/lib/prisma.ts")).default;
      await prisma.$disconnect();
      process.exit(!a.ok && a.code === "KILL_SWITCH" ? 0 : 1);
    `,
  },
  {
    id: "GR7",
    name: "Post-condition verification detects an unchanged world",
    file: "src/agents/runtime/verification.ts",
    find: `      const satisfied = RESOLVED_TICKET_STATUSES.has(String(ticket.status));`,
    // The dangerous version: assume the tool's success means the state changed.
    replace: `      const satisfied = true;`,
    probe: `
      const prisma = (await import("SRC/lib/prisma.ts")).default;
      const { verifyPostCondition } = await import("SRC/agents/runtime/verification.ts");
      await prisma.supportTicket.update({ where: { id: "phase16-ticket-open" }, data: { status: "OPEN" } });
      const v = await verifyPostCondition(
        { check: "ticket.status.changed", subjectArgument: "ticketId", expected: "RESOLVED" },
        { ticketId: "phase16-ticket-open" }, new Date());
      await prisma.$disconnect();
      process.exit(v.verdict === "FAILED" ? 0 : 1);
    `,
  },
];

/**
 * Line endings are normalised before matching.
 *
 * This repository contains a mix of CRLF and LF, sometimes within the same file. A multi-line
 * anchor written with \n does not match a region terminated with \r\n, and the failure mode is
 * the dangerous one: GR1 reported "anchor not found" rather than "guard broken", and if that
 * were ever downgraded to a warning the whole exercise would silently test nothing.
 *
 * The patched file is written with LF; the ORIGINAL bytes are restored afterwards and verified
 * by hash, so normalisation never leaks into the committed source.
 */
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function sha(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Run a probe in a fresh child process, so module caching cannot mask a removed guard. */
function runProbe(guard: Guard): boolean {
  const src = resolve(ROOT, "src").replace(/\\/g, "/");
  const body = guard.probe.replace(/SRC/g, src);
  const tmp = resolve(ROOT, `.probe-${guard.id}.ts`);
  writeFileSync(tmp, `await (async () => {\n${body}\n})();\n`);
  try {
    const out = spawnSync("bun", ["run", tmp], {
      cwd: ROOT,
      env: { ...process.env, HOMIGO_STAGING: "1" },
      encoding: "utf-8",
      timeout: 60_000,
    });
    return out.status === 0;
  } finally {
    try {
      require("fs").unlinkSync(tmp);
    } catch {
      /* the probe file is disposable; a failed unlink must not mask the result */
    }
  }
}

type Verdict = "LOAD_BEARING" | "NOT_LOAD_BEARING" | "PROBE_BROKEN" | "RESTORE_FAILED";
const verdicts: Array<{ id: string; name: string; verdict: Verdict; detail: string }> = [];

function main(): void {
  const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
  if (process.env.APP_ENV !== "staging" || !db.includes("staging")) {
    throw new Error(`REFUSING: guard removal edits source and touches data; APP_ENV=${process.env.APP_ENV} db=${db}`);
  }
  console.log(`[guard] staging confirmed (${db})\n`);

  for (const g of GUARDS) {
    const path = resolve(ROOT, g.file);
    const original = readFileSync(path, "utf-8");
    const originalHash = sha(path);

    console.log(`\n── ${g.id} ${g.name}`);

    const normalized = normalize(original);
    if (!normalized.includes(normalize(g.find))) {
      verdicts.push({ id: g.id, name: g.name, verdict: "PROBE_BROKEN", detail: "anchor text not found in source" });
      console.log("   ANCHOR NOT FOUND — the guard text has moved; probe cannot be trusted");
      continue;
    }

    // 1. Intact
    const before = runProbe(g);
    console.log(`   1. guard intact       → probe ${before ? "PASS" : "FAIL"}`);
    if (!before) {
      verdicts.push({ id: g.id, name: g.name, verdict: "PROBE_BROKEN", detail: "probe failed with the guard intact" });
      continue;
    }

    let during = false;
    try {
      // 2. Removed
      writeFileSync(path, normalized.replace(normalize(g.find), normalize(g.replace)));
      during = runProbe(g);
      console.log(`   2. guard removed      → probe ${during ? "PASS (!!)" : "FAIL"}`);
    } finally {
      // 3. Restore, always, and verify the bytes.
      writeFileSync(path, original);
      const restoredHash = sha(path);
      if (restoredHash !== originalHash) {
        verdicts.push({ id: g.id, name: g.name, verdict: "RESTORE_FAILED", detail: `hash ${restoredHash} != ${originalHash}` });
        console.log("   3. RESTORE FAILED — source does not match the original");
        continue;
      }
      console.log("   3. restored           → hash matches original");
    }

    // 4. Intact again
    const after = runProbe(g);
    console.log(`   4. guard restored     → probe ${after ? "PASS" : "FAIL"}`);

    const verdict: Verdict = !during && after ? "LOAD_BEARING" : during ? "NOT_LOAD_BEARING" : "PROBE_BROKEN";
    verdicts.push({
      id: g.id,
      name: g.name,
      verdict,
      detail: `intact=PASS removed=${during ? "PASS" : "FAIL"} restored=${after ? "PASS" : "FAIL"}`,
    });
  }

  console.log(`\n${"=".repeat(74)}`);
  const loadBearing = verdicts.filter((v) => v.verdict === "LOAD_BEARING").length;
  for (const v of verdicts) console.log(`  ${v.verdict.padEnd(18)} ${v.id} ${v.name}\n       ${v.detail}`);
  console.log(`\nGUARD REMOVAL: ${loadBearing}/${GUARDS.length} guards proven load-bearing`);
  console.log("=".repeat(74));

  process.exit(loadBearing === GUARDS.length ? 0 : 1);
}

main();
