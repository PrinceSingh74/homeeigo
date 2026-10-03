/**
 * Phase 16 pass 4 — guard-removal self-test (§68).
 *
 * A green suite proves the tests pass. It does not prove the CONTROL is what made them pass.
 * So for each control added in this pass: break it in the source, re-run the probe in a CHILD
 * PROCESS, and require the probe to FAIL. Then restore and verify the restore by hash.
 *
 * The child process is not optional. Bun caches modules, so patching a file and re-importing it
 * in-process re-reads nothing and the probe passes against the ORIGINAL code — a guard-removal
 * test that silently proves nothing, which is worse than not having one.
 *
 * A control that cannot be broken into failing was never doing the work its name claims.
 */

import { spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "../..");

/**
 * Probe imports are RELATIVE, not absolute.
 *
 * The probe file is written into the backend root and run with that root as cwd, so `./src/...`
 * resolves to exactly the specifier the modules under test use internally. An absolute
 * `D:/homigo/...` specifier does NOT: bun treats it as a distinct module id from the relative one
 * the internal imports resolve to, so the probe receives a SECOND copy of the registry. Mutating
 * that copy changes nothing the code under test can see, and the probe then reports
 * UNKNOWN_CAPABILITY against a guard that is working perfectly.
 */
type Guard = {
  id: string;
  description: string;
  file: string;
  /** The exact source to break, and what to break it into. */
  from: string;
  to: string;
  /** A probe that must SUCCEED intact and FAIL broken. */
  probe: string;
};

const GUARDS: Guard[] = [
  {
    id: "G-INTENT",
    description: "§8 — a read-only intent forbids a write step",
    file: "src/agents/planning/plan-validator.ts",
    // Neuter the intent gate by making the side-effect test unreachable.
    from: '    if (intent && cap.risk !== "LOW") {',
    to: '    if (false && intent && cap.risk !== "LOW") {',
    probe: `
      import { validatePlan } from "./src/agents/planning/plan-validator";
      import { resolveIntent } from "./src/agents/planning/intent";
      const r = validatePlan(
        "support",
        { goal: "g", reason: "r", steps: [{ capability: "ticket.resolve", arguments: { ticketId: "t1", resolution: "x" }, reason: "", expectedEffect: "" }] },
        resolveIntent({ goal: "Why was this ticket delayed?" }),
      );
      if (r.ok) { console.log("PROBE_FAIL: a write was allowed under EXPLAIN"); process.exit(1); }
      if (r.code !== "INTENT_FORBIDS_SIDE_EFFECT") { console.log("PROBE_FAIL: wrong code " + r.code); process.exit(1); }
      console.log("PROBE_OK");
    `,
  },
  {
    id: "G-CLARIFY",
    description: "§9 — a missing required argument is asked about, not guessed",
    file: "src/agents/planning/plan-validator.ts",
    from: "  if (clarifications.length > 0) {",
    to: "  if (false && clarifications.length > 0) {",
    probe: `
      import { validatePlan } from "./src/agents/planning/plan-validator";
      import { resolveIntent } from "./src/agents/planning/intent";
      const r = validatePlan(
        "support",
        { goal: "g", reason: "r", steps: [{ capability: "ticket.resolve", arguments: { resolution: "x" }, reason: "", expectedEffect: "" }] },
        resolveIntent({ goal: "Resolve the ticket" }),
      );
      if (r.ok) { console.log("PROBE_FAIL: an underspecified plan was accepted"); process.exit(1); }
      if (r.code !== "NEEDS_CLARIFICATION") { console.log("PROBE_FAIL: wrong code " + r.code); process.exit(1); }
      console.log("PROBE_OK");
    `,
  },
  {
    id: "G-FRESH-STALE",
    description: "§35 — stale evidence is refused, not rounded up to fresh",
    file: "src/agents/runtime/freshness.ts",
    from: '    verdict: clampedAge <= params.maxAgeMs ? "FRESH" : "STALE",',
    to: '    verdict: "FRESH",',
    probe: `
      import { assessFreshness } from "./src/agents/runtime/freshness";
      const now = Date.now();
      const r = assessFreshness({ result: { freshness: new Date(now - 600000).toISOString() }, maxAgeMs: 300000, now });
      if (r.verdict !== "STALE") { console.log("PROBE_FAIL: 600s-old data verdict " + r.verdict); process.exit(1); }
      console.log("PROBE_OK");
    `,
  },
  {
    id: "G-FRESH-UNKNOWN",
    description: "§35 — an undatable read is UNKNOWN and still blocks a write",
    file: "src/agents/runtime/freshness.ts",
    // The classic wrong fix: treat "I could not tell how old this is" as "it is current".
    from: '  return assessment.verdict === "STALE" || assessment.verdict === "UNKNOWN";',
    to: '  return assessment.verdict === "STALE";',
    probe: `
      import { assessFreshness, blocksDownstreamWrite } from "./src/agents/runtime/freshness";
      const r = assessFreshness({ result: { data: { zones: [] } }, maxAgeMs: 300000 });
      if (r.verdict !== "UNKNOWN") { console.log("PROBE_FAIL: undatable verdict " + r.verdict); process.exit(1); }
      if (!blocksDownstreamWrite(r)) { console.log("PROBE_FAIL: UNKNOWN did not block a write"); process.exit(1); }
      console.log("PROBE_OK");
    `,
  },
  {
    id: "G-INTENT-DEFAULT",
    description: "§8 — an unrecognised request defaults to read-only, not to permissive",
    file: "src/agents/planning/intent.ts",
    from: "    permitsSideEffect: false,\n    humanOnly: false,\n  };\n}",
    to: "    permitsSideEffect: true,\n    humanOnly: false,\n  };\n}",
    probe: `
      import { resolveIntent } from "./src/agents/planning/intent";
      const r = resolveIntent({ goal: "zx qq plover" });
      if (r.source !== "DEFAULTED") { console.log("PROBE_FAIL: source " + r.source); process.exit(1); }
      if (r.permitsSideEffect) { console.log("PROBE_FAIL: the default reading permitted a side effect"); process.exit(1); }
      console.log("PROBE_OK");
    `,
  },
  {
    id: "G-READONLY-AGENT",
    description: "the read-only agents still cannot plan a write after the capability additions",
    file: "src/agents/planning/plan-validator.ts",
    from: '    if (def.readOnly && cap.risk !== "LOW") {',
    to: '    if (false && def.readOnly && cap.risk !== "LOW") {',
    /**
     * Nothing in the finance or fraud vocabulary is non-LOW, because the registry throws at import
     * if it were. So this validator check is unreachable through a normal plan, and the only
     * scenario it defends is the one the load-time check by construction cannot see: a definition
     * mutated AFTER the registry has already validated.
     *
     * The probe therefore initialises the registry first — which is what makes the load-time check
     * stop re-running — and only then injects the write. Mutating before initialisation would trip
     * the registry's own throw instead, and would prove that guard rather than this one.
     */
    probe: `
      import { AGENT_DEFINITIONS, initAgentRegistry } from "./src/agents/registry/agent-registry";
      import { validatePlan } from "./src/agents/planning/plan-validator";
      initAgentRegistry();
      AGENT_DEFINITIONS.finance.capabilities.push({
        name: "finance.payout", description: "x", toolId: "write.ops.resolveAlert",
        risk: "MEDIUM", dataClasses: ["FINANCIAL"], allowedArguments: ["alertId"],
        postCondition: { check: "none.readonly" },
      });
      const r = validatePlan("finance", { goal: "g", reason: "r", steps: [{ capability: "finance.payout", arguments: { alertId: "a1" }, reason: "", expectedEffect: "" }] });
      if (r.ok) { console.log("PROBE_FAIL: a read-only agent planned a write"); process.exit(1); }
      if (r.code !== "READ_ONLY_VIOLATION") { console.log("PROBE_FAIL: wrong code " + r.code); process.exit(1); }
      console.log("PROBE_OK");
    `,
  },
];

function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function runProbe(source: string): { ok: boolean; output: string } {
  const tmp = path.join(ROOT, `.probe-${crypto.randomBytes(6).toString("hex")}.ts`);
  fs.writeFileSync(tmp, source, "utf8");
  try {
    const r = spawnSync("bun", ["run", tmp], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
    return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

let loadBearing = 0;
let notLoadBearing = 0;
const problems: string[] = [];

console.log("\n=== Pass-4 guard removal ===\n");

for (const guard of GUARDS) {
  const abs = path.join(ROOT, guard.file);
  const original = fs.readFileSync(abs, "utf8");
  const beforeHash = sha256(abs);

  // Normalise the anchor to the file's own line endings before searching.
  const nl = original.includes("\r\n") ? "\r\n" : "\n";
  const from = guard.from.replace(/\n/g, nl);
  const to = guard.to.replace(/\n/g, nl);

  if (original.split(from).length - 1 !== 1) {
    problems.push(`${guard.id}: anchor not found exactly once in ${guard.file}`);
    console.log(`  ERROR ${guard.id}  anchor not found exactly once — cannot test this guard`);
    continue;
  }

  // 1. intact
  const intact = runProbe(guard.probe);
  if (!intact.ok) {
    problems.push(`${guard.id}: probe failed against INTACT source — the probe is wrong`);
    console.log(`  ERROR ${guard.id}  probe failed intact: ${intact.output.split("\n")[0]}`);
    continue;
  }

  // 2. broken
  try {
    fs.writeFileSync(abs, original.replace(from, to), "utf8");
    const broken = runProbe(guard.probe);
    if (broken.ok) {
      notLoadBearing += 1;
      problems.push(`${guard.id}: probe STILL PASSED with the guard removed — not load-bearing`);
      console.log(`  NOT-LOAD-BEARING  ${guard.id}  ${guard.description}`);
    } else {
      loadBearing += 1;
      console.log(`  LOAD-BEARING      ${guard.id}  ${guard.description}`);
    }
  } finally {
    // 3. restore, and PROVE the restore.
    fs.writeFileSync(abs, original, "utf8");
    const afterHash = sha256(abs);
    if (afterHash !== beforeHash) {
      problems.push(`${guard.id}: FILE NOT RESTORED (${guard.file})`);
      console.log(`  !! ${guard.id} DID NOT RESTORE ${guard.file}`);
    }
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`  ${loadBearing}/${GUARDS.length} LOAD-BEARING   ${notLoadBearing} not load-bearing`);
if (problems.length > 0) {
  console.log("\nProblems:");
  for (const p of problems) console.log(`  - ${p}`);
}
console.log(`${"=".repeat(60)}\n`);

process.exit(problems.length === 0 && loadBearing === GUARDS.length ? 0 : 1);
