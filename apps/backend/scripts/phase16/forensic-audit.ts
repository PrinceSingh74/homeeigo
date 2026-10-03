/**
 * Phase 16 — second-pass forensic audit (§74, §82).
 *
 * Written on the assumption that the Phase-16 architecture is WRONG and the previous report was
 * optimistic. It audits the code as if inherited from another team, hunting specifically for the
 * thirteen failure classes §74 names — a tool bypass, a direct provider call, an RBAC leak, a
 * cross-agent data leak, a recursive loop, a budget bypass, a missing audit, a high-risk
 * autonomous path, a stale-data action, a duplicate side effect, a hidden production mutation, a
 * PII leak, an invalid approval binding.
 *
 * Static checks read the real source. Live checks read the real database. Nothing is asserted from
 * the previous suite's results — a second pass that trusts the first pass is not a second pass.
 */
import "../../src/load-env";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import prisma from "../../src/lib/prisma";
import { initAgents, AGENT_IDS } from "../../src/agents";
import { getAgentDefinition } from "../../src/agents/registry/agent-registry";
import { getTool, listTools } from "../../src/ai-tools/registry/tool-registry";

type Finding = { id: string; severity: "P0" | "P1" | "P2" | "INFO"; title: string; detail: string };
const findings: Finding[] = [];
const checks: Array<{ id: string; name: string; ok: boolean; detail: string }> = [];

function check(id: string, name: string, ok: boolean, detail: string, severity: Finding["severity"] = "P1"): void {
  checks.push({ id, name, ok, detail });
  console.log(`[${ok ? "OK  " : "FAIL"}] ${id} ${name}\n       ${detail}`);
  if (!ok) findings.push({ id, severity, title: name, detail });
}

const BACKEND = resolve(import.meta.dir, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function agentSources(): Array<{ path: string; text: string }> {
  return walk(join(BACKEND, "src/agents")).map((p) => ({ path: p, text: readFileSync(p, "utf-8") }));
}

/** Strip comments so a control described in prose is never mistaken for a control in code. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

async function main(): Promise<void> {
  const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
  console.log(`[context] database=${db} APP_ENV=${process.env.APP_ENV}\n`);
  initAgents();

  const sources = agentSources().map((s) => ({ ...s, code: stripComments(s.text) }));

  console.log("=== F1. PROVIDER BYPASS (§69) ===");
  const providerHits = sources.flatMap((s) =>
    [...s.code.matchAll(/\b(fetch|axios|generateContent|embedContent|generativelanguage|api\.groq|api\.openai)\b/g)].map(
      (m) => `${s.path.replace(BACKEND, "")}:${m[1]}`,
    ),
  );
  check("F1", "No agent module calls an AI provider directly", providerHits.length === 0,
    providerHits.length ? providerHits.join(", ") : "every inference path goes through invokeAiGateway", "P0");

  console.log("\n=== F2. TOOL BYPASS (§7) ===");
  // Any agent-layer import of a business service would be a path around executeTool.
  const serviceImports = sources.flatMap((s) =>
    [...s.code.matchAll(/from ["']\.\.\/\.\.\/services\/([\w-]+)\.service["']/g)].map(
      (m) => `${s.path.replace(BACKEND, "")} -> ${m[1]}`,
    ),
  );
  const allowedServiceImports = ["feature-flag", "audit-log"];
  const illegalServiceImports = serviceImports.filter(
    (i) => !allowedServiceImports.some((a) => i.endsWith(`-> ${a}`)),
  );
  check("F2", "Agents import no business service directly", illegalServiceImports.length === 0,
    illegalServiceImports.length
      ? illegalServiceImports.join(", ")
      : `only governance services imported (${allowedServiceImports.join(", ")})`, "P0");

  console.log("\n=== F3. HIGH-RISK AUTONOMOUS PATH (§57, §58) ===");
  let highRiskCaps = 0;
  let writeCapsOnReadOnly = 0;
  for (const agentId of AGENT_IDS) {
    const def = getAgentDefinition(agentId);
    for (const cap of def.capabilities) {
      const tool = getTool(cap.toolId!);
      if (tool?.category === "HIGH_RISK") highRiskCaps += 1;
      if (def.readOnly && tool?.category !== "READ") writeCapsOnReadOnly += 1;
    }
  }
  check("F3a", "No agent can name a HIGH_RISK tool", highRiskCaps === 0, `highRiskCapabilities=${highRiskCaps}`, "P0");
  check("F3b", "No read-only agent holds a write capability", writeCapsOnReadOnly === 0,
    `violations=${writeCapsOnReadOnly}`, "P0");

  /**
   * The catalog's money and enforcement surface must stay outside every agent vocabulary.
   *
   * The pattern below is deliberately OVER-INCLUSIVE — it matches on the tool id, ignoring
   * category, so `read.finance.getPayoutMetrics` trips it despite being a read that cannot move a
   * rupee. That is the correct behaviour for a P0 tripwire: a detector tuned until it stops
   * complaining is a detector that has stopped working, and the failure it guards against (a
   * money tool quietly entering an agent's reach) is not one to trade sensitivity for quiet.
   *
   * So the fix for a false positive is NOT to loosen the pattern. It is to write down why the
   * match is acceptable, here, where the next person will read it. Anything matching the pattern
   * and absent from this list fails the check.
   */
  const REVIEWED_EXCEPTIONS: Record<string, string> = {
    "read.finance.getPayoutMetrics":
      "READ. Aggregate counts and mean settlement time. Cannot move, release or retry a payout.",
    "read.finance.getPayoutQueue":
      "READ. Lists withdrawals awaiting settlement so the assistant can explain a mismatch. " +
      "Approving, releasing and retrying all remain human actions in the payout console.",
    "write.support.escalateTicket":
      "WRITE, but matches only on the word 'escalate'. It raises a SUPPORT TICKET's priority and " +
      "attaches an internal note — no money, no enforcement, no account state. Escalation is the " +
      "direction that hands work TO a human, and its failure mode costs a person a few minutes.",
  };

  const dangerous = listTools().filter(
    (t) => t.category === "HIGH_RISK" || /refund|payout|ban|suspend|freeze|revers|settle|adjust|escalat/i.test(t.toolId),
  );
  const agentToolIds = new Set(
    AGENT_IDS.flatMap((a) => getAgentDefinition(a).capabilities.map((c) => c.toolId!)),
  );
  const reachable = dangerous.filter((t) => agentToolIds.has(t.toolId));
  const unjustified = reachable.filter((t) => !REVIEWED_EXCEPTIONS[t.toolId]);
  check("F3c", "Every money/enforcement-shaped tool an agent can reach is a reviewed exception",
    unjustified.length === 0,
    `matched=${dangerous.length} reachable=${reachable.length} reviewed=${reachable.length - unjustified.length}` +
      (unjustified.length ? ` UNJUSTIFIED=${unjustified.map((t) => t.toolId).join(",")}` : ""),
    "P0");

  /**
   * The exception list is itself a control surface, so it gets its own check.
   *
   * Without this, "add it to the exceptions" would be a one-line way to hand an agent a refund
   * tool. A HIGH_RISK tool or a money-MOVING write can never be excepted, whatever anybody writes
   * in the justification string.
   */
  const badExceptions = Object.keys(REVIEWED_EXCEPTIONS).filter((id) => {
    const t = listTools().find((x) => x.toolId === id);
    if (!t) return true; // a stale entry for a tool that no longer exists
    if (t.category === "HIGH_RISK") return true;
    return t.category !== "READ" && /refund|payout|ban|suspend|freeze|revers|settle|adjust/i.test(t.toolId);
  });
  check("F3d", "The exception list cannot launder a HIGH_RISK or money-moving tool",
    badExceptions.length === 0,
    badExceptions.length ? `INVALID=${badExceptions.join(",")}` : `${Object.keys(REVIEWED_EXCEPTIONS).length} exceptions, all READ or non-money`,
    "P0");

  console.log("\n=== F4. CROSS-AGENT LEAK (§52) ===");
  const vocab = new Map(AGENT_IDS.map((a) => [a, new Set(getAgentDefinition(a).capabilities.map((c) => c.name))]));
  const financeTools = new Set(getAgentDefinition("finance").capabilities.map((c) => c.toolId));
  const fraudTools = new Set(getAgentDefinition("fraud").capabilities.map((c) => c.toolId));
  let leaks = 0;
  for (const a of AGENT_IDS) {
    if (a === "finance" || a === "fraud") continue;
    for (const cap of getAgentDefinition(a).capabilities) {
      if (financeTools.has(cap.toolId) || fraudTools.has(cap.toolId)) leaks += 1;
    }
  }
  check("F4a", "No non-finance agent shares a finance or fraud TOOL", leaks === 0, `sharedTools=${leaks}`, "P0");
  check("F4b", "Finance and fraud vocabularies are disjoint",
    [...(vocab.get("finance") ?? [])].every((c) => !vocab.get("fraud")?.has(c)),
    "no capability name appears in both", "P1");

  console.log("\n=== F5. MISSING AUDIT (§35) ===");
  const runtimeSrc = sources.find((s) => s.path.endsWith("agent-runtime.ts"))!;
  const hasVoidAudit = /void\s+audit\(/.test(runtimeSrc.code);
  const auditCalls = (runtimeSrc.code.match(/await audit\(/g) ?? []).length;
  check("F5a", "No fire-and-forget audit call", !hasVoidAudit, `awaitedAuditCalls=${auditCalls} voidAuditCalls=0`, "P1");
  check("F5b", "Audit covers start, plan accept, plan reject, escalation and completion",
    auditCalls >= 5, `awaited audit call sites=${auditCalls}`, "P1");

  console.log("\n=== F6. BUDGET / BOUND BYPASS (§10, §63) ===");
  const boundCheck = /function boundExceeded/.test(runtimeSrc.code);
  const boundCalledBeforeStep = /const bound = boundExceeded\(acc, bounds\);/.test(runtimeSrc.code);
  check("F6a", "Bounds are evaluated before each step, not after", boundCheck && boundCalledBeforeStep,
    `boundExceeded defined=${boundCheck} calledInLoop=${boundCalledBeforeStep}`, "P1");
  // Every loop in the runtime must be bounded by a literal or a bound, never `while (true)`.
  const unbounded = sources.filter((s) => /while\s*\(\s*true\s*\)|for\s*\(\s*;;\s*\)/.test(s.code));
  check("F6b", "No unbounded loop anywhere in the agent layer", unbounded.length === 0,
    unbounded.map((s) => s.path.replace(BACKEND, "")).join(", ") || "none", "P0");

  console.log("\n=== F7. RECURSION (§30) ===");
  const policySrc = sources.find((s) => s.path.endsWith("agent-policy.ts"))!;
  check("F7", "Recursion guard checks BOTH depth and ancestry",
    /RECURSION_DEPTH_EXCEEDED/.test(policySrc.code) && /RECURSION_CYCLE_DETECTED/.test(policySrc.code),
    "depth ceiling and parent-chain walk both present", "P0");

  console.log("\n=== F8. DUPLICATE SIDE EFFECT (§26, §45) ===");
  const dupes = await prisma.$queryRawUnsafe<Array<{ idempotency_key: string; n: bigint }>>(
    `select idempotency_key, count(*) as n from agent_runs
     where idempotency_key is not null group by idempotency_key having count(*) > 1`,
  );
  check("F8a", "No duplicate run idempotency key exists in the database", dupes.length === 0,
    `duplicateKeys=${dupes.length}`, "P0");

  // Two agent steps must never share a tool execution id — that would mean one side effect
  // attributed to two steps, which is how a double effect hides.
  const sharedExec = await prisma.$queryRawUnsafe<Array<{ execution_id: string; n: bigint }>>(
    `select execution_id, count(*) as n from agent_run_steps
     where execution_id is not null group by execution_id having count(*) > 1`,
  );
  check("F8b", "No tool execution is claimed by two agent steps", sharedExec.length === 0,
    `sharedExecutions=${sharedExec.length}`, "P0");

  console.log("\n=== F9. STALE / UNVERIFIED SUCCESS (§14, §33) ===");
  // Any step recorded SUCCESSFUL whose post-condition did not hold is a contradiction that must
  // never have been allowed to complete the run.
  const badVerify = await prisma.$queryRawUnsafe<Array<{ run_id: string; status: string }>>(
    `select s.run_id, r.status from agent_run_steps s
     join agent_runs r on r.run_id = s.run_id
     where s.status = 'VERIFICATION_FAILED' and r.status = 'COMPLETED'`,
  );
  check("F9", "No run COMPLETED with a failed post-condition", badVerify.length === 0,
    `completedRunsWithFailedVerification=${badVerify.length}`, "P0");

  console.log("\n=== F10. STRANDED RUNS (state machine integrity) ===");
  const stranded = await prisma.$queryRawUnsafe<Array<{ status: string; n: bigint }>>(
    `select status, count(*) as n from agent_runs
     where completed_at is null
       and status not in ('CREATED','PLANNING','WAITING_POLICY','WAITING_APPROVAL','EXECUTING','VERIFYING')
     group by status`,
  );
  check("F10a", "No terminal run is missing its completedAt", stranded.length === 0,
    `terminalWithoutCompletedAt=${stranded.length}`, "P1");

  const oldActive = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `select count(*) as n from agent_runs
     where status in ('CREATED','PLANNING','WAITING_POLICY','EXECUTING','VERIFYING')
       and heartbeat_at < now() - interval '1 hour'`,
  );
  const orphanCount = Number(oldActive[0]?.n ?? 0);
  check("F10b", "No run has been stuck non-terminal for over an hour", orphanCount === 0,
    `stuckOverOneHour=${orphanCount} (recovery sweep should have reconciled these)`, "P1");

  console.log("\n=== F11. PII IN TELEMETRY (§55) ===");
  const metricsSrc = sources.find((s) => s.path.endsWith("agent-metrics.ts"))!;
  // Any label built from a variable that is not a closed enum is unbounded cardinality and,
  // on this platform, very likely personal data.
  const riskyLabels = [...metricsSrc.code.matchAll(/\{\s*([a-z_]+):\s*(\w+)/g)]
    .map((m) => `${m[1]}=${m[2]}`)
    .filter((l) => /user|actor|ticket|subject|run|email|phone|provider/i.test(l));
  check("F11a", "No metric label carries an identity", riskyLabels.length === 0,
    riskyLabels.length ? riskyLabels.join(", ") : "labels are agent id, mode, tier and closed codes only", "P1");

  // The stored plan must be redacted, and the raw model text must never be persisted.
  const storesRawModelText = /plan:\s*\{[^}]*content/.test(runtimeSrc.code) || /rawOutput|modelText/.test(runtimeSrc.code);
  check("F11b", "Raw model output is never persisted", !storesRawModelText,
    "only capability names, server risk and redacted arguments are stored", "P1");
  check("F11c", "Stored plan arguments pass through redactArguments",
    /arguments: redactArguments\(/.test(runtimeSrc.code),
    "plan step arguments are redacted before persistence", "P1");

  console.log("\n=== F12. CONFIRMATION / APPROVAL BINDING (§22) ===");
  // `confirmed: true` must appear exactly once, and only after the disposition gate.
  const confirmedCount = (runtimeSrc.code.match(/confirmed:\s*true/g) ?? []).length;
  const confirmAfterDisposition =
    runtimeSrc.code.indexOf("disposition.action") < runtimeSrc.code.indexOf("confirmed: true");
  check("F12a", "Confirmation is asserted exactly once, after the risk gate",
    confirmedCount === 1 && confirmAfterDisposition,
    `occurrences=${confirmedCount} afterDispositionGate=${confirmAfterDisposition}`, "P0");

  // No agent-layer code may create or decide an approval.
  const approvalWrites = sources.filter((s) => /createApprovalRequest|decideApproval|consumeApproval/.test(s.code));
  check("F12b", "The agent layer never creates or decides an approval", approvalWrites.length === 0,
    approvalWrites.map((s) => s.path.replace(BACKEND, "")).join(", ") || "approval flow stays in the tool layer", "P0");

  console.log("\n=== F13. PRODUCTION MUTATION SAFETY (§70) ===");
  /**
   * Every script that can WRITE to a database must refuse to run outside staging.
   *
   * The first version of this check matched the literal string `APP_ENV !== "staging"` with exact
   * spacing, plus a `staging only` escape hatch. Both were wrong in opposite directions: the
   * spacing made it report two genuinely-guarded seeds as unguarded (they write
   * `appEnv !== "staging"` and `process.env.APP_ENV!=="staging"`), while the escape hatch let any
   * file containing that phrase in a COMMENT pass without a guard at all.
   *
   * So the check now asserts the real property in two parts:
   *
   *   1. Scope by capability, not by folder. A script that never opens a database connection
   *      cannot mutate one — `migration-guard-selftest.ts` writes SQL fixtures to a temp directory
   *      and shells out to the guard. Demanding a staging check there would be cargo-culting, and
   *      a guard nobody needs is a guard everybody learns to copy without thinking.
   *
   *   2. Require BOTH halves for the scripts that do connect: the environment name (what someone
   *      intended) and the database name (where the writes actually land). Only the second one can
   *      hurt anybody, which is why a staging config pointed at the dev database must still fail.
   *
   * Whitespace-insensitive, so a reformat cannot silently disarm the audit.
   */
  const scripts = walk(join(BACKEND, "scripts/phase16")).map((p) => ({
    path: p,
    text: readFileSync(p, "utf-8"),
  }));

  /**
   * The property is "can this script WRITE", not "can it connect".
   *
   * Sharpened after this very check flagged the forensic audit itself. That script connects to the
   * database and issues nothing but SELECTs — and auditing a NON-staging database is exactly what
   * it is for. Forcing a staging guard onto it would have made the platform's own read-only audit
   * tool unusable against the environment anyone would most want to audit.
   *
   * So a script is only required to carry the guard if it can mutate: any `create`, `update`,
   * `upsert`, `delete` or raw-execute call. A read-only script is exempt, and that exemption is
   * itself asserted below rather than assumed — a script that later grows a write must fail this
   * check, not quietly inherit the exemption.
   */
  const MUTATION = /\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany|\$executeRaw|\$executeRawUnsafe)\s*[({]/;
  const touchesDatabase = (text: string) => /from ["'].*lib\/prisma["']/.test(text);
  const canMutate = (text: string) => touchesDatabase(text) && MUTATION.test(stripComments(text));
  const hasEnvGuard = (text: string) =>
    /APP_ENV\s*!==\s*["']staging["']|appEnv\s*!==\s*["']staging["']/.test(text);
  const hasDbNameGuard = (text: string) => /includes\(\s*["']staging["']\s*\)/.test(text);

  const mutating = scripts.filter((s) => canMutate(s.text));
  const unguardedMutating = mutating.filter((s) => !(hasEnvGuard(s.text) && hasDbNameGuard(s.text)));

  check("F13a", "Every Phase-16 script that can WRITE refuses to run outside staging",
    unguardedMutating.length === 0,
    unguardedMutating.length
      ? `unguarded=${unguardedMutating.map((s) => s.path.replace(BACKEND, "")).join(", ")}`
      : `${mutating.length}/${mutating.length} mutating scripts guarded on env AND db-name`,
    "P0");

  /**
   * The stronger assertion, and the one that actually holds the line.
   *
   * F13a depends on statically spotting a mutation, and that detector under-reads by construction:
   * `seed-tool-registry-staging.ts` contains no `.create(` at all — its writes happen inside the
   * imported `seedToolRegistry()`. Classified on text alone it looks read-only, and it is only
   * safe because it independently carries a guard.
   *
   * Rather than chase call graphs, the requirement is inverted: EVERY script that can reach a
   * database must be guarded, and the only permitted exemption is a script that never imports
   * prisma at all. That is decidable from the import list, cannot be fooled by an indirect write,
   * and fails closed — a new script that imports prisma is unguarded until someone adds the check.
   */
  /**
   * Exactly one declared exemption, and it has to earn it.
   *
   * This audit is the exemption. It imports prisma, and auditing a NON-staging database is
   * precisely what it is for — a read-only forensic tool that refuses to look at production is
   * useless at the moment it matters most. So it is exempt, by name, in code, where a reviewer
   * sees it; not by an accident of pattern matching.
   *
   * The exemption is conditional on being genuinely read-only, asserted below against this file's
   * own source. If someone later adds a write here, F13c fails and the exemption evaporates.
   */
  const EXEMPT_READ_ONLY = ["forensic-audit.ts"];

  const dbCapable = scripts.filter((s) => touchesDatabase(s.text));
  const noDatabase = scripts.filter((s) => !touchesDatabase(s.text));
  const isExempt = (s: { path: string }) =>
    EXEMPT_READ_ONLY.includes(s.path.split(/[\\/]/).pop() ?? "");

  const unguardedDbCapable = dbCapable.filter(
    (s) => !isExempt(s) && !(hasEnvGuard(s.text) && hasDbNameGuard(s.text)),
  );

  check("F13b", "Every database-capable script is guarded, except one declared read-only auditor",
    unguardedDbCapable.length === 0,
    unguardedDbCapable.length
      ? `unguarded=${unguardedDbCapable.map((s) => s.path.split(/[\\/]/).pop()).join(", ")}`
      : `${dbCapable.length - EXEMPT_READ_ONLY.length}/${dbCapable.length - EXEMPT_READ_ONLY.length} guarded; declared exempt: ${EXEMPT_READ_ONLY.join(", ")}; no prisma: ${noDatabase.map((s) => s.path.split(/[\\/]/).pop()).join(", ") || "none"}`,
    "P0");

  const exemptFiles = scripts.filter(isExempt);
  check("F13c", "The declared exemption is genuinely read-only",
    exemptFiles.length === EXEMPT_READ_ONLY.length &&
      exemptFiles.every((s) => !MUTATION.test(stripComments(s.text))),
    exemptFiles.length === 0
      ? "declared exemption not found on disk"
      : `${exemptFiles.length} exempt file(s), zero mutation calls`,
    "P0");

  console.log("\n=== F14. RBAC — agent role is never taken from the caller ===");
  const routeSrc = readFileSync(join(BACKEND, "src/routes/agents.routes.ts"), "utf-8");
  const runtimeOverridesRole = /actorRole: getAgentDefinition\(request\.agentId\)\.actorRole/.test(runtimeSrc.code);
  check("F14a", "The runtime executes as the AGENT's declared role, not the caller's",
    runtimeOverridesRole, "executeTool is passed the definition's actorRole", "P0");
  /**
   * Count ROUTE DECLARATIONS, not every `.get(` in the file.
   *
   * The first version of this check matched `\.(get|post)\(` anywhere and counted four
   * `request.headers.get(...)` calls as routes, reporting a P0 "half the routes are unguarded" on
   * a file where every route is in fact guarded. A forensic audit that cries wolf is worse than no
   * audit, because the next real finding gets waved away with it.
   *
   * A route declaration in this Elysia chain is a `.method(` at the start of a line, optionally
   * followed by a quoted path on the same line (the multi-line form puts the path on the next).
   */
  const routeDecls = [...routeSrc.matchAll(/^\s*\.(get|post|put|patch|delete)\(/gm)].length;
  const adminGuards = (routeSrc.match(/requireAdmin\(role, set\)/g) ?? []).length;
  // Exactly one route may be unguarded: the liveness probe, which reports only whether the layer
  // is enabled and whether the switch is pulled — it enumerates no agent and no capability.
  const publicRoutes = routeDecls - adminGuards;
  check("F14b", "Every agent route except the liveness probe is admin-gated",
    publicRoutes === 1 && /\.get\("\/health"/.test(routeSrc),
    `routes=${routeDecls} adminGuarded=${adminGuards} public=${publicRoutes} (only /health)`, "P0");

  console.log("\n=== F15. LIVE DATA — what actually happened on this database ===");
  const [runCount, stepCount, execJoin, escalations] = await Promise.all([
    prisma.agentRun.count(),
    prisma.agentRunStep.count(),
    prisma.agentRunStep.count({ where: { executionId: { not: null } } }),
    prisma.agentRun.count({ where: { status: "ESCALATED" } }),
  ]);
  const orphanExec = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `select count(*) as n from agent_run_steps s
     where s.execution_id is not null
       and not exists (select 1 from ai_tool_executions e where e.execution_id = s.execution_id)`,
  );
  check("F15", "Every agent step execution id resolves to a real tool execution row",
    Number(orphanExec[0]?.n ?? 0) === 0,
    `runs=${runCount} steps=${stepCount} stepsWithExecution=${execJoin} danglingExecutionIds=${Number(orphanExec[0]?.n ?? 0)} escalated=${escalations}`, "P0");

  const ok = checks.filter((c) => c.ok).length;
  const bad = checks.filter((c) => !c.ok).length;
  console.log(`\n${"=".repeat(74)}`);
  console.log(`FORENSIC SECOND PASS: ${ok} OK, ${bad} FINDINGS (${checks.length} checks)`);
  if (findings.length > 0) {
    console.log("\nFINDINGS:");
    for (const f of findings) console.log(`  [${f.severity}] ${f.id} ${f.title}\n        ${f.detail}`);
  }
  console.log("=".repeat(74));

  await prisma.$disconnect();
  process.exit(bad > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("FORENSIC AUDIT FAILED:", err);
  await prisma.$disconnect();
  process.exit(2);
});
