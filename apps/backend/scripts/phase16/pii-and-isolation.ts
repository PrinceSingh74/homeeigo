/**
 * Phase 16 — PII, tenant isolation and data-classification certification (§18, §50, §52, §53).
 *
 * Reads what the platform ACTUALLY persisted rather than what the code intends. Every check below
 * queries real rows produced by real runs, because the failure mode being hunted is "the redaction
 * helper was not called on one path", and no amount of reading the helper proves it was.
 */
import "../../src/load-env";
import prisma from "../../src/lib/prisma";
import { initAgents, AGENT_IDS, getAgentDefinition } from "../../src/agents";
import { getTool } from "../../src/ai-tools/registry/tool-registry";

type Result = { id: string; name: string; status: "PASS" | "FAIL"; detail: string };
const results: Result[] = [];
function check(id: string, name: string, ok: boolean, detail: string): void {
  results.push({ id, name, status: ok ? "PASS" : "FAIL", detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${id} ${name}\n        ${detail}`);
}

function assertStaging(): void {
  const db = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
  if (process.env.APP_ENV !== "staging" || !db.includes("staging")) {
    throw new Error(`REFUSING: APP_ENV=${process.env.APP_ENV} db=${db}`);
  }
  console.log(`[guard] staging confirmed (${db})\n`);
}

/**
 * Patterns that indicate real personal data, not merely a field named after it.
 *
 * Deliberately value-shaped rather than key-shaped. A key called `email` in a redaction allowlist
 * is fine; an actual address in a stored plan is not, and only a value pattern catches the second
 * without drowning in the first.
 */
const PII_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "email", re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
  /**
   * Every numeric pattern is fenced with `(?<!\d)` and `(?!\d)`.
   *
   * Without the leading lookbehind, `[6-9]\d{9}` matches *inside* any longer digit run — and `\b`
   * does not help, because `\b` treats `_` as a word character, so it never fires in an identifier
   * like `phase16_e2e_1788701557660`. That single missing assertion reported 74 of 109 event
   * payloads as leaking a phone number; every one was a slice of a millisecond timestamp.
   *
   * A scanner that fires on two-thirds of clean rows gets muted, and the next real leak goes with
   * it. The fence makes each pattern match a WHOLE number rather than a window into one.
   */
  { name: "phone", re: /(?<!\d)(?:\+91[-\s]?)?[6-9]\d{9}(?!\d)/ },
  { name: "aadhaar", re: /(?<!\d)\d{4}\s\d{4}\s\d{4}(?!\d)/ },
  { name: "pan", re: /\b[A-Z]{5}\d{4}[A-Z]\b/ },
  { name: "coordinates", re: /(?<!\d)\d{1,2}\.\d{5,}\s*,\s*\d{1,3}\.\d{5,}(?!\d)/ },
];

/**
 * Card numbers are detected by Luhn, not by shape.
 *
 * The first version matched any 13–16 digit run and reported 96 of 109 event payloads as leaking
 * card data. Every one was a false positive: `"ticketNumber": "TKT-20260906-425402"` is fourteen
 * digits once the separators are stripped, and so is a pair of adjacent ISO timestamps.
 *
 * A PII scanner that cries wolf on 88% of rows is worse than none — the next real leak is dismissed
 * along with the noise. Luhn is what actually distinguishes a payment card from an arbitrary digit
 * run, so the detector validates the value rather than guessing from its length.
 */
function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function containsCardNumber(text: string): boolean {
  // Candidate runs of digits with optional single spaces/hyphens, then Luhn-checked.
  for (const match of text.matchAll(/\b(?:\d[ -]?){12,18}\d\b/g)) {
    if (luhnValid(match[0].replace(/[^\d]/g, ""))) return true;
  }
  return false;
}

/**
 * Remove platform-generated identifiers before scanning.
 *
 * A UUID's last group is twelve hex characters, and roughly one in ten contains a ten-digit run
 * beginning 6–9 — `42855494-2c7f-4c0b-9620-7274721125c7` yields `7274721125`, which is a perfectly
 * well-formed Indian mobile number and is not one. The same is true of cuids and epoch
 * milliseconds.
 *
 * Loosening the phone pattern to dodge this would also stop it finding a real number written next
 * to an id. Stripping the identifiers first is the honest move: they are structural, they are not
 * personal data, and what remains is exactly the text worth scanning.
 */
function stripStructuralIds(text: string): string {
  return text
    // UUID v4 and friends
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "«uuid»")
    // cuid / cuid2 — the id format this schema uses for most primary keys
    .replace(/\bc[a-z0-9]{20,}\b/gi, "«cuid»")
    // epoch milliseconds, which appear inside generated test identifiers
    .replace(/(?<!\d)1[6-9]\d{11}(?!\d)/g, "«epoch»")
    // ISO timestamps
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "«ts»")
    /**
     * Ticket numbers: `TKT-YYYYMMDD-NNNNNN`.
     *
     * Fourteen digits once the hyphens are stripped, so roughly one in ten passes Luhn by
     * coincidence — two did, out of the ticket events on this database. Like the UUIDs above this
     * is a platform-generated identifier, not payment data, and classifying it as structural is
     * more honest than weakening the Luhn check that makes card detection meaningful at all.
     */
    .replace(/\bTKT-\d{8}-\d{4,8}\b/g, "«ticketNo»");
}

function scanForPii(raw: string): string[] {
  const text = stripStructuralIds(raw);
  const hits = PII_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
  if (containsCardNumber(text)) hits.push("card");
  return hits;
}

async function main(): Promise<void> {
  assertStaging();
  initAgents();

  console.log("=== X. PII IN PERSISTED AGENT DATA ===");

  // X1 — stored plans. These are written on every accepted plan and are the most likely place for
  // an argument value to leak, because the plan is stored for the operator timeline.
  const plans = await prisma.agentRun.findMany({
    where: { plan: { not: null } },
    select: { runId: true, plan: true },
    take: 500,
  });
  const planLeaks = plans
    .map((p) => ({ runId: p.runId, hits: scanForPii(JSON.stringify(p.plan)) }))
    .filter((p) => p.hits.length > 0);
  check("X1", "No persisted agent plan contains personal data",
    planLeaks.length === 0,
    `plansScanned=${plans.length} leaking=${planLeaks.length}${planLeaks.length ? ` e.g. ${planLeaks[0]!.runId}: ${planLeaks[0]!.hits.join(",")}` : ""}`);

  // X2 — step argument previews. Redacted at write time; this proves the redaction actually ran.
  const steps = await prisma.agentRunStep.findMany({
    where: { argumentsPreview: { not: null } },
    select: { id: true, argumentsPreview: true },
    take: 1000,
  });
  const stepLeaks = steps
    .map((s) => ({ id: s.id, hits: scanForPii(JSON.stringify(s.argumentsPreview)) }))
    .filter((s) => s.hits.length > 0);
  check("X2", "No persisted step argument preview contains personal data",
    stepLeaks.length === 0,
    `stepsScanned=${steps.length} leaking=${stepLeaks.length}${stepLeaks.length ? ` e.g. ${stepLeaks[0]!.hits.join(",")}` : ""}`);

  // X3 — run goals and error messages. Free-text fields an operator reads.
  const runText = await prisma.agentRun.findMany({
    select: { runId: true, goal: true, errorMessage: true, escalationReason: true },
    take: 1000,
  });
  const textLeaks = runText
    .map((r) => ({
      runId: r.runId,
      hits: scanForPii(`${r.goal} ${r.errorMessage ?? ""} ${r.escalationReason ?? ""}`),
    }))
    .filter((r) => r.hits.length > 0);
  check("X3", "No run goal, error or escalation reason contains personal data",
    textLeaks.length === 0,
    `runsScanned=${runText.length} leaking=${textLeaks.length}`);

  // X4 — the outbox. Events are durable, replayable and fanned out to consumers nobody enumerated.
  const events = await prisma.eventOutbox.findMany({
    where: {
      eventType: {
        in: ["homigo.support.ticket.created", "homigo.ops.alert.raised", "homigo.partner.paused"],
      },
    },
    select: { eventId: true, eventType: true, payload: true },
    take: 500,
  });
  const eventLeaks = events
    .map((e) => ({ eventId: e.eventId, type: e.eventType, hits: scanForPii(JSON.stringify(e.payload)) }))
    .filter((e) => e.hits.length > 0);
  check("X4", "No Phase-16 event payload contains personal data",
    eventLeaks.length === 0,
    `eventsScanned=${events.length} leaking=${eventLeaks.length}${eventLeaks.length ? ` e.g. ${eventLeaks[0]!.type}: ${eventLeaks[0]!.hits.join(",")}` : ""}`);

  // X5 — free-text prose from tickets must not appear in event payloads even when it is not PII.
  // Checked separately because untrusted prose is prompt-injection cargo regardless of content.
  const supportEvents = await prisma.eventOutbox.findMany({
    where: { eventType: "homigo.support.ticket.created" },
    select: { payload: true },
    take: 200,
  });
  const carriesProse = supportEvents.filter((e) => {
    const data = (e.payload as { data?: Record<string, unknown> })?.data ?? {};
    return "subject" in data || "description" in data || "message" in data;
  });
  check("X5", "Support event payloads carry no free-text fields at all",
    carriesProse.length === 0,
    `eventsScanned=${supportEvents.length} carryingProse=${carriesProse.length}`);

  console.log("\n=== Y. DATA CLASSIFICATION & ISOLATION ===");

  // Y1 — every capability's data classes are a subset of its agent's declared classes.
  let undeclared = 0;
  for (const agentId of AGENT_IDS) {
    const def = getAgentDefinition(agentId);
    for (const cap of def.capabilities) {
      for (const dc of cap.dataClasses) {
        if (!def.dataClasses.includes(dc)) undeclared += 1;
      }
    }
  }
  check("Y1", "No capability touches a data class its agent does not declare",
    undeclared === 0, `violations=${undeclared}`);

  // Y2 — FINANCIAL and FRAUD classes are confined to the two agents that declare them.
  const financialHolders = AGENT_IDS.filter((a) =>
    getAgentDefinition(a).dataClasses.includes("FINANCIAL"),
  );
  const fraudHolders = AGENT_IDS.filter((a) => getAgentDefinition(a).dataClasses.includes("FRAUD"));
  check("Y2", "FINANCIAL and FRAUD data classes are confined to their own agents",
    financialHolders.length === 1 && financialHolders[0] === "finance" &&
      fraudHolders.length === 1 && fraudHolders[0] === "fraud",
    `financial=${financialHolders.join(",")} fraud=${fraudHolders.join(",")}`);

  // Y3 — no agent has actually executed a tool belonging to another agent's vocabulary.
  // Checked against persisted rows, not the registry: this is the behavioural counterpart to the
  // structural cross-agent checks.
  const vocab = new Map(
    AGENT_IDS.map((a) => [a, new Set(getAgentDefinition(a).capabilities.map((c) => c.toolId))]),
  );
  const executed = await prisma.agentRunStep.findMany({
    where: { toolId: { not: null } },
    select: { toolId: true, run: { select: { agentId: true } } },
    take: 5000,
  });
  const foreign = executed.filter(
    (s) => !vocab.get(s.run.agentId as never)?.has(s.toolId ?? undefined),
  );
  check("Y3", "No agent has ever executed a tool outside its own vocabulary",
    foreign.length === 0,
    `stepsScanned=${executed.length} foreign=${foreign.length}${foreign.length ? ` e.g. ${foreign[0]!.run.agentId} -> ${foreign[0]!.toolId}` : ""}`);

  // Y4 — every tool an agent actually executed is READ, except the declared writes.
  const declaredWrites = new Set(
    AGENT_IDS.flatMap((a) =>
      getAgentDefinition(a)
        .capabilities.filter((c) => getTool(c.toolId!)?.category !== "READ")
        .map((c) => c.toolId!),
    ),
  );
  const unexpectedWrites = executed.filter(
    (s) => s.toolId && !s.toolId.startsWith("read.") && !declaredWrites.has(s.toolId),
  );
  check("Y4", "No agent executed a write outside its declared write capabilities",
    unexpectedWrites.length === 0,
    `declaredWrites=${declaredWrites.size} unexpected=${unexpectedWrites.length}`);

  // Y5 — the two read-only agents have executed zero non-read tools, ever.
  const readOnlyWrites = executed.filter(
    (s) =>
      ["finance", "fraud"].includes(s.run.agentId) &&
      s.toolId &&
      !s.toolId.startsWith("read."),
  );
  check("Y5", "Finance and Fraud have never executed a non-read tool",
    readOnlyWrites.length === 0, `violations=${readOnlyWrites.length}`);

  console.log("\n=== Z. FINANCE & FRAUD PATH SAFETY ===");

  // Z1 — no agent step has ever referenced a money or enforcement tool, in any status.
  const dangerous = await prisma.agentRunStep.count({
    where: {
      OR: [
        { toolId: { startsWith: "high_risk." } },
        { toolId: { contains: "refund" } },
        { toolId: { contains: "payout" } },
        { toolId: { contains: "Ban" } },
        { toolId: { contains: "Suspend" } },
      ],
    },
  });
  check("Z1", "No agent step has ever referenced a money or enforcement tool",
    dangerous === 0, `steps=${dangerous}`);

  // Z2 — no approval raised by an agent run was ever both requested and approved by the same actor.
  const selfApproved = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `select count(*) as n from ai_tool_approvals
     where requested_by is not null and approved_by is not null and requested_by = approved_by`,
  );
  check("Z2", "No approval was self-approved",
    Number(selfApproved[0]?.n ?? 0) === 0, `selfApproved=${Number(selfApproved[0]?.n ?? 0)}`);

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.length - pass;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`PII & ISOLATION: ${pass} PASS, ${fail} FAIL`);
  for (const r of results.filter((x) => x.status === "FAIL")) console.log(`  FAIL ${r.id}: ${r.detail}`);
  console.log("=".repeat(70));

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error("PII HARNESS FAILED:", err);
  await prisma.$disconnect();
  process.exit(2);
});
