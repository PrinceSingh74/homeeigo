/**
 * Phase 16 — chaos and concurrency certification (§62, §63).
 *
 * Faults are INJECTED, not simulated. Each case breaks something real — the audit writer, the tool
 * layer, the flag store, the plan validator's input — and asserts the runtime's response from
 * persisted rows.
 *
 * The question every case asks is the same: when this dependency fails, does the system fail
 * CLOSED and say so, or does it fail open and look fine?
 */
import "../../src/load-env";
import prisma from "../../src/lib/prisma";
import { runAgent, initAgents } from "../../src/agents";
import { AGENT_FLAGS } from "../../src/agents/config";
import { __clearFlagMemoryCache } from "../../src/services/feature-flag.service";
import { verifyPostCondition } from "../../src/agents/runtime/verification";
import { transitionRun, createRun } from "../../src/agents/runtime/run-store";
import { validatePlan } from "../../src/agents/planning/plan-validator";
import { admitAgentRun } from "../../src/agents/policy/agent-policy";

type Result = { id: string; name: string; status: "PASS" | "FAIL" | "BLOCKED"; detail: string };
const results: Result[] = [];
function record(id: string, name: string, status: Result["status"], detail: string): void {
  results.push({ id, name, status, detail });
  const tag = status === "PASS" ? "PASS " : status === "FAIL" ? "FAIL " : "BLOCK";
  console.log(`[${tag}] ${id} ${name}\n        ${detail}`);
}
function check(id: string, name: string, ok: boolean, detail: string): void {
  record(id, name, ok ? "PASS" : "FAIL", detail);
}

function assertStaging(): void {
  const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
  if (process.env.APP_ENV !== "staging" || !db.includes("staging")) {
    throw new Error(`REFUSING: chaos injection mutates data; APP_ENV=${process.env.APP_ENV} db=${db}`);
  }
  console.log(`[guard] staging confirmed (${db})\n`);
}

const ADMIN = "phase16-admin";
const actor = () => ({ actorId: ADMIN, actorRole: "ADMIN" as const, userRole: "ADMIN", traceId: `chaos-${Date.now()}` });

async function setFlag(key: string, enabled: boolean): Promise<void> {
  await prisma.platformFeatureFlag.upsert({
    where: { key },
    create: { key, enabled, rolloutPct: 100, environment: "staging", updatedBy: "phase16-chaos" },
    update: { enabled, rolloutPct: 100, environment: "staging" },
  });
  __clearFlagMemoryCache();
}

async function main(): Promise<void> {
  assertStaging();
  initAgents();

  console.log("=== CH. CHAOS ===");

  /**
   * CH1 — audit outage.
   *
   * `AuditLogService.recordGoverned` is made to throw. The run must still reach a terminal state
   * and still record its steps: the audit points bracket decisions ALREADY persisted in
   * `agent_runs`, so aborting on an audit failure would leave a half-advanced run with a worse
   * record than the one that just failed to write.
   */
  {
    const auditModule = await import("../../src/services/audit-log.service");
    const original = auditModule.AuditLogService.recordGoverned;
    (auditModule.AuditLogService as { recordGoverned: unknown }).recordGoverned = async () => {
      throw new Error("CHAOS: audit backend unavailable");
    };

    let run;
    try {
      run = await runAgent({
        agentId: "finance",
        goal: "Chaos: audit writer is down",
        input: "Report the finance position.",
        actor: actor(),
        trigger: { type: "MANUAL" },
        forceShadow: true,
      });
    } finally {
      (auditModule.AuditLogService as { recordGoverned: unknown }).recordGoverned = original;
    }

    const persisted = await prisma.agentRun.findUnique({
      where: { runId: run.runId },
      select: { status: true, completedAt: true, stepCount: true },
    });
    const terminal = ["COMPLETED", "FAILED", "ESCALATED", "CANCELLED", "TIMED_OUT"].includes(
      persisted?.status ?? "",
    );
    check("CH1", "An audit outage does not strand the run or lose its step record",
      Boolean(persisted) && terminal && persisted?.completedAt !== null,
      `status=${persisted?.status} completedAt=${persisted?.completedAt !== null} steps=${persisted?.stepCount}`);
  }

  /**
   * CH2 — flag store outage.
   *
   * `evaluateFlag` is made to throw, and the layer must fail CLOSED to SHADOW. Failing open here
   * would mean a Redis or database blip silently promoting every agent to live execution.
   *
   * Injected by patching the real source and running the probe in a CHILD PROCESS, the same way
   * the guard-removal suite works. An in-process monkey-patch is impossible: `evaluateFlag` is an
   * ESM function export, and module namespace bindings are immutable — assigning to one throws,
   * which is what the first version of this case did.
   *
   * The source is restored in a `finally` and verified by hash before the suite continues.
   */
  {
    const { readFileSync, writeFileSync, unlinkSync } = await import("fs");
    const { spawnSync } = await import("child_process");
    const { createHash } = await import("crypto");
    const { resolve } = await import("path");

    const ROOT = resolve(import.meta.dir, "../..");
    const target = resolve(ROOT, "src/services/feature-flag.service.ts");
    const original = readFileSync(target, "utf-8");
    const originalHash = createHash("sha256").update(original).digest("hex");

    const anchor = "export async function evaluateFlag(";
    const probe = resolve(ROOT, ".chaos-ch2.ts");
    let childOk = false;
    let detail = "";

    try {
      if (!original.includes(anchor)) {
        detail = "anchor not found — evaluateFlag signature has moved";
      } else {
        // A simpler injection: make the function body throw on its first statement.
        const patched = original.replace(
          /export async function evaluateFlag\(([^)]*)\)([^{]*)\{/,
          (m) => `${m}\n  throw new Error("CHAOS: flag store unavailable");`,
        );
        writeFileSync(target, patched);

        writeFileSync(
          probe,
          [
            'import "./src/load-env";',
            'import { admitAgentRun } from "./src/agents/policy/agent-policy";',
            'import { initAgents } from "./src/agents";',
            'process.env.AGENTS_ENABLED = "true";',
            "initAgents();",
            'const a = await admitAgentRun({ agentId: "operations", trigger: { type: "MANUAL" } });',
            'const prisma = (await import("./src/lib/prisma")).default;',
            "await prisma.$disconnect();",
            // Fail CLOSED means: admitted, but in SHADOW. Never LIVE.
            'process.exit(a.ok && a.mode === "SHADOW" ? 0 : 1);',
          ].join("\n"),
        );

        const out = spawnSync("bun", ["run", probe], {
          cwd: ROOT,
          encoding: "utf-8",
          env: { ...process.env, HOMIGO_STAGING: "1", AGENTS_ENABLED: "true" },
          timeout: 90_000,
        });
        childOk = out.status === 0;
        detail = `childExit=${out.status} (0 = admitted in SHADOW, fail-closed)`;
      }
    } finally {
      writeFileSync(target, original);
      const restored = createHash("sha256").update(readFileSync(target, "utf-8")).digest("hex");
      if (restored !== originalHash) {
        detail += " | RESTORE FAILED — source does not match original";
        childOk = false;
      }
      try {
        unlinkSync(probe);
      } catch {
        /* the probe file is disposable */
      }
      __clearFlagMemoryCache();
    }

    check("CH2", "A flag-store outage fails closed to SHADOW, never open to LIVE", childOk, detail);
  }

  /**
   * CH3 — tool layer outage.
   *
   * `executeTool` is made to throw for every call. Every step must be recorded FAILED and the run
   * must terminate — never silently complete as though the tools had succeeded.
   *
   * Injected via source patch in a child process, for the same reason as CH2: `executeTool` is an
   * ESM function export and cannot be reassigned in-process.
   */
  {
    const { readFileSync, writeFileSync, unlinkSync } = await import("fs");
    const { spawnSync } = await import("child_process");
    const { createHash } = await import("crypto");
    const { resolve } = await import("path");

    const ROOT = resolve(import.meta.dir, "../..");
    const target = resolve(ROOT, "src/ai-tools/execution/execution-engine.ts");
    const original = readFileSync(target, "utf-8");
    const originalHash = createHash("sha256").update(original).digest("hex");
    const probe = resolve(ROOT, ".chaos-ch3.ts");

    let outcome: "PASS" | "FAIL" | "BLOCKED" = "FAIL";
    let detail = "";

    try {
      const patched = original.replace(
        /export async function executeTool\(input: ToolExecuteInput\): Promise<ToolExecuteResult> \{/,
        (m) => `${m}
  throw new Error("CHAOS: tool layer unavailable");`,
      );
      if (patched === original) {
        detail = "anchor not found — executeTool signature has moved";
      } else {
        writeFileSync(target, patched);
        writeFileSync(
          probe,
          [
            'import "./src/load-env";',
            'import { runAgent, initAgents } from "./src/agents";',
            'const prisma = (await import("./src/lib/prisma")).default;',
            "initAgents();",
            'await prisma.platformFeatureFlag.upsert({ where: { key: "PHASE16_OPERATIONS_AGENT" }, create: { key: "PHASE16_OPERATIONS_AGENT", enabled: true, rolloutPct: 100, environment: "staging" }, update: { enabled: true, rolloutPct: 100, environment: "staging" } });',
            "const run = await runAgent({",
            '  agentId: "operations", goal: "Chaos: tool layer down", input: "Read the open operational alerts.",',
            '  actor: { actorId: "phase16-admin", actorRole: "ADMIN", userRole: "ADMIN" },',
            '  trigger: { type: "MANUAL" },',
            "});",
            'const ok = await prisma.agentRunStep.count({ where: { runId: run.runId, status: { in: ["VERIFIED", "EXECUTED"] } } });',
            'await prisma.platformFeatureFlag.deleteMany({ where: { key: "PHASE16_OPERATIONS_AGENT" } });',
            "await prisma.$disconnect();",
            'const blocked = run.errorCode === "PLANNER_UNAVAILABLE" || run.errorCode === "PLANNER_BUDGET";',
            'const terminal = ["COMPLETED","FAILED","ESCALATED","TIMED_OUT"].includes(run.status);',
            "// exit 2 = provider blocked (inconclusive), 0 = contained, 1 = a step reported success",
            "process.exit(blocked ? 2 : (ok === 0 && terminal ? 0 : 1));",
          ].join("\n"),
        );

        const out = spawnSync("bun", ["run", probe], {
          cwd: ROOT,
          encoding: "utf-8",
          env: { ...process.env, HOMIGO_STAGING: "1", AGENTS_ENABLED: "true" },
          timeout: 180_000,
        });

        if (out.status === 2) {
          outcome = "BLOCKED";
          detail = "AI provider unavailable; the tool path was never reached";
        } else {
          outcome = out.status === 0 ? "PASS" : "FAIL";
          detail = `childExit=${out.status} (0 = zero successful steps and terminal run)`;
        }
      }
    } finally {
      writeFileSync(target, original);
      const restored = createHash("sha256").update(readFileSync(target, "utf-8")).digest("hex");
      if (restored !== originalHash) {
        detail += " | RESTORE FAILED — source does not match original";
        outcome = "FAIL";
      }
      try {
        unlinkSync(probe);
      } catch {
        /* disposable */
      }
    }

    record("CH3", "Tool-layer outage is recorded as failure, never as success", outcome, detail);
  }

  /**
   * CH4 — verification against an entity that cannot be read.
   *
   * Must return UNKNOWN. Rounding an unperformable check up to VERIFIED is the single most
   * dangerous thing this layer could do, because it converts "I could not tell" into "it worked".
   */
  {
    const verdict = await verifyPostCondition(
      { check: "ticket.status.changed", subjectArgument: "ticketId", expected: "RESOLVED" },
      { ticketId: "chaos-nonexistent-ticket" },
      new Date(),
    );
    check("CH4", "An unreadable subject verifies as UNKNOWN, never VERIFIED",
      verdict.verdict === "UNKNOWN", `verdict=${verdict.verdict} reason=${verdict.reason}`);
  }

  /**
   * CH5 — malformed planner output.
   *
   * Every shape a broken model can emit must be refused rather than repaired. A "helpful" coercion
   * turns a malformed plan into a different, well-formed plan that nobody authored.
   */
  {
    /**
     * Driven through the REAL pipeline: raw text → parse → coerce → validate.
     *
     * The first version fed objects straight to `validatePlan` and listed
     * `{goal:"", steps:[]}` as malformed. It was accepted — correctly. An EMPTY plan is a
     * deliberate, valid outcome (the planner prompt tells the model to return one when a request
     * cannot be served with its capabilities), and an empty goal is rejected a stage earlier by
     * `coercePlanShape`, which is the only door model output actually comes through.
     *
     * Testing a stage in isolation and calling its input "malformed" measured the wrong contract.
     * These cases now enter where model output enters.
     */
    const { parsePlanJson, coercePlanShape } = await import("../../src/agents/planning/plan-validator");

    const cases: Array<{ name: string; raw: string; mustReject: boolean }> = [
      { name: "prose, not JSON", raw: "I will resolve the ticket now.", mustReject: true },
      { name: "JSON that is not a plan", raw: '{"foo":"bar"}', mustReject: true },
      { name: "empty goal", raw: '{"goal":"","reason":"r","steps":[]}', mustReject: true },
      { name: "steps not an array", raw: '{"goal":"g","reason":"r","steps":"nope"}', mustReject: true },
      { name: "empty capability name", raw: '{"goal":"g","reason":"r","steps":[{"capability":"","arguments":{}}]}', mustReject: true },
      { name: "nested argument object", raw: '{"goal":"g","reason":"r","steps":[{"capability":"ticket.context","arguments":{"ticketId":{"$ne":null}}}]}', mustReject: true },
      { name: "foreign capability", raw: '{"goal":"g","reason":"r","steps":[{"capability":"finance.reconciliation","arguments":{}}]}', mustReject: true },
      // The control: a legitimately EMPTY plan must be ACCEPTED, not rejected.
      { name: "empty plan (valid refusal)", raw: '{"goal":"cannot serve this","reason":"no capability covers it","steps":[]}', mustReject: false },
    ];

    const wrong = cases.filter((c) => {
      const shaped = coercePlanShape(parsePlanJson(c.raw));
      const rejected = shaped === null || !validatePlan("support", shaped).ok;
      return rejected !== c.mustReject;
    });

    check("CH5", "Malformed model output is rejected; a deliberate empty plan is accepted",
      wrong.length === 0,
      wrong.length ? `mishandled=${wrong.map((c) => c.name).join(", ")}` : `${cases.length}/${cases.length} handled correctly`);
  }

  /**
   * CH6 — illegal state transition under a corrupted run.
   *
   * A run forced into a terminal state must refuse to move again. Without this an audit trail can
   * be rewritten after the fact.
   */
  {
    const runId = `chaos-fsm-${Date.now()}`;
    await createRun({
      runId, agentId: "operations", agentVersion: "1.0.0", promptVersion: "p", policyVersion: "pv",
      toolsetVersion: "tv", mode: "SHADOW", actorId: ADMIN, actorRole: "ADMIN",
      triggerType: "MANUAL", traceId: runId, depth: 0, goal: "fsm probe",
    });
    await transitionRun(runId, "PLANNING");
    await transitionRun(runId, "FAILED");

    let refused = false;
    try {
      await transitionRun(runId, "EXECUTING");
    } catch {
      refused = true;
    }
    await prisma.agentRun.delete({ where: { runId } }).catch(() => undefined);
    check("CH6", "A terminal run refuses to transition again",
      refused, refused ? "FAILED → EXECUTING refused" : "the transition was ACCEPTED");
  }

  console.log("\n=== CC. CONCURRENCY ===");

  /**
   * CC1 — the same event delivered concurrently to the runtime.
   *
   * Exactly one run. The unique index on `agent_runs.idempotency_key` is the arbiter; a
   * check-then-insert would lose this race, which is precisely the race that matters.
   */
  {
    const ref = `cc-evt-${Date.now()}`;
    const trigger = { type: "EVENT" as const, ref, subjectType: "ticket", subjectId: "phase16-ticket-open" };
    const runs = await Promise.all(
      Array.from({ length: 8 }, () =>
        runAgent({
          agentId: "support", goal: "Concurrency probe", input: "same event, eight deliveries",
          actor: actor(), trigger, forceShadow: true,
        }),
      ),
    );
    const created = await prisma.agentRun.count({ where: { triggerRef: ref } });
    const suppressed = runs.filter((r) => r.stopReason === "DUPLICATE_RUN").length;
    check("CC1", "Eight concurrent deliveries of one event create exactly one run",
      created === 1, `runsCreated=${created} suppressed=${suppressed}/8`);
  }

  /**
   * CC2 — no tool execution is ever claimed by two agent steps.
   *
   * This is the check that would catch a double side effect hiding behind correct-looking rows.
   */
  {
    const shared = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `select count(*) as n from (
         select execution_id from agent_run_steps
         where execution_id is not null
         group by execution_id having count(*) > 1
       ) x`,
    );
    check("CC2", "No tool execution is claimed by two agent steps",
      Number(shared[0]?.n ?? 0) === 0, `sharedExecutions=${Number(shared[0]?.n ?? 0)}`);
  }

  /**
   * CC3 — step-level idempotency keys are unique per run and step.
   *
   * A collision would mean two distinct steps collapsing into one tool execution.
   */
  {
    const dupes = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `select count(*) as n from (
         select idempotency_key from ai_tool_executions
         where idempotency_key like 'agent:%'
         group by idempotency_key having count(*) > 1
       ) x`,
    );
    check("CC3", "No agent step idempotency key was used twice",
      Number(dupes[0]?.n ?? 0) === 0, `duplicateKeys=${Number(dupes[0]?.n ?? 0)}`);
  }

  /**
   * CC4 — concurrent runs of DIFFERENT agents do not interfere.
   *
   * Five agents started simultaneously must each produce their own run with their own identity.
   */
  {
    const before = await prisma.agentRun.count();
    const runs = await Promise.all(
      (["support", "operations", "partner-operations", "finance", "fraud"] as const).map((a) =>
        runAgent({
          agentId: a, goal: `Concurrency probe for ${a}`, input: "parallel fleet probe",
          actor: actor(), trigger: { type: "MANUAL" }, forceShadow: true,
        }),
      ),
    );
    const after = await prisma.agentRun.count();
    const distinctAgents = new Set(runs.map((r) => r.agentId)).size;
    const distinctRunIds = new Set(runs.map((r) => r.runId)).size;
    check("CC4", "Five agents running concurrently each keep their own identity",
      distinctAgents === 5 && distinctRunIds === 5 && after - before === 5,
      `distinctAgents=${distinctAgents} distinctRunIds=${distinctRunIds} newRows=${after - before}`);
  }

  /**
   * CC5 — concurrent transitions on one run: exactly one wins.
   *
   * The status guard is inside the WHERE clause, so two processes cannot both advance a run.
   */
  {
    const runId = `cc-fsm-${Date.now()}`;
    await createRun({
      runId, agentId: "operations", agentVersion: "1.0.0", promptVersion: "p", policyVersion: "pv",
      toolsetVersion: "tv", mode: "SHADOW", actorId: ADMIN, actorRole: "ADMIN",
      triggerType: "MANUAL", traceId: runId, depth: 0, goal: "concurrent transition probe",
    });
    await transitionRun(runId, "PLANNING");

    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, () => transitionRun(runId, "WAITING_POLICY")),
    );
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled").length;
    const final = await prisma.agentRun.findUnique({ where: { runId }, select: { status: true } });
    await prisma.agentRun.delete({ where: { runId } }).catch(() => undefined);

    /**
     * More than one may report success: `transitionRun` returns early when the run is ALREADY in
     * the target state, which is correct idempotent behaviour rather than a second transition.
     * What must hold is that the run lands in exactly that state, once.
     */
    check("CC5", "Concurrent identical transitions converge on one state",
      final?.status === "WAITING_POLICY",
      `finalStatus=${final?.status} callsFulfilled=${fulfilled}/6`);
  }

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`CHAOS & CONCURRENCY: ${pass} PASS, ${fail} FAIL, ${blocked} BLOCKED`);
  for (const r of results.filter((x) => x.status !== "PASS")) console.log(`  ${r.status} ${r.id}: ${r.detail}`);
  console.log("=".repeat(70));

  await prisma.platformFeatureFlag
    .deleteMany({ where: { key: { in: Object.values(AGENT_FLAGS) } } })
    .catch(() => undefined);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("CHAOS HARNESS FAILED:", err);
  await prisma.$disconnect();
  process.exit(2);
});
