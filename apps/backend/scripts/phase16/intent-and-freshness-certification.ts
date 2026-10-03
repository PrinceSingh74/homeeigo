/**
 * Phase 16 — certification for the three controls added in pass 4.
 *
 *   §8  intent resolution      — a request for information cannot produce a change
 *   §9  clarification          — an underspecified request asks, it does not guess
 *   §35 data freshness         — stale or undatable evidence cannot justify a write
 *
 * Pure unit-level: no database, no model provider, no network. These three controls are
 * decision functions, and the thing worth proving about a decision function is its decisions.
 * Driving them through a live run would prove the same thing more slowly, less completely, and
 * with a provider quota standing between the suite and its own result.
 *
 * Includes NEGATIVE CONTROLS throughout. A test that only asserts "the write was refused" passes
 * just as happily against a validator that refuses everything, so every refusal here is paired
 * with a case that must be ALLOWED.
 */

import {
  resolveIntent,
  intentPermitsSideEffect,
  intentIsHumanOnly,
  AGENT_INTENTS,
} from "../../src/agents/planning/intent";
import { validatePlan } from "../../src/agents/planning/plan-validator";
import { assessFreshness, blocksDownstreamWrite } from "../../src/agents/runtime/freshness";
import { initAgentRegistry, listAgentDefinitions } from "../../src/agents/registry/agent-registry";
import type { ProposedPlan } from "../../src/agents/types";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${id}  ${detail}`);
  } else {
    fail += 1;
    failures.push(`${id}: ${detail}`);
    console.log(`  FAIL  ${id}  ${detail}`);
  }
}

function plan(capability: string, args: Record<string, unknown>): ProposedPlan {
  return {
    goal: "test",
    reason: "test",
    steps: [{ capability, arguments: args, reason: "r", expectedEffect: "e" }],
  };
}

console.log("\n=== A. Intent classification (§8) ===\n");

// The exact example the brief gives, and the exact failure it names.
const why = resolveIntent({ goal: "Why was this booking delayed?" });
check("A1", why.intent === "EXPLAIN", `"Why was this booking delayed?" -> ${why.intent}`);
check("A2", !why.permitsSideEffect, "EXPLAIN does not permit a side effect");

const fix = resolveIntent({ goal: "Fix the booking assignment for HOM-123" });
check("A3", fix.intent === "EXECUTE", `"Fix the booking..." -> ${fix.intent}`);
check("A4", fix.permitsSideEffect, "EXECUTE permits a side effect");

// Precedence: a sentence carrying both a diagnostic and an imperative resolves to the read-only
// reading. This is the ambiguity that matters most, because it is how a question becomes an act.
const both = resolveIntent({ goal: "Why did this fail, and can you fix it?" });
check("A5", both.intent === "EXPLAIN", `mixed diagnostic+imperative -> ${both.intent} (read-only wins)`);

// The unrecognised case must fail toward the restrictive reading, not the permissive one.
const gibberish = resolveIntent({ goal: "zx qq plover" });
check("A6", gibberish.source === "DEFAULTED", `unrecognised phrasing -> source=${gibberish.source}`);
check("A7", !gibberish.permitsSideEffect, "the default reading permits no side effect");

// Human-only intents are named and refused rather than reinterpreted.
const approve = resolveIntent({ goal: "Approve the refund for booking HOM-9" });
check("A8", approve.intent === "APPROVE" && approve.humanOnly, `"Approve..." -> ${approve.intent}, humanOnly`);
check("A9", !approve.permitsSideEffect, "APPROVE is not an agent-executable intent");

// A declared intent from a trusted call site is honoured...
const declared = resolveIntent({ goal: "anything at all", declared: "EXECUTE" });
check("A10", declared.intent === "EXECUTE" && declared.source === "DECLARED", "declared intent honoured");

// ...but a typo in one must not become a permissive grant.
const typo = resolveIntent({ goal: "Why is this failing?", declared: "EXECUTEE" });
check(
  "A11",
  typo.intent === "EXPLAIN" && !typo.permitsSideEffect,
  `unrecognised declaration falls through to classification -> ${typo.intent}`,
);

// Word-boundary regression: "cancellation policy" is a question about a policy, not a command.
const cancellation = resolveIntent({ goal: "What is the cancellation policy for late jobs?" });
check(
  "A12",
  !cancellation.permitsSideEffect,
  `"cancellation policy" -> ${cancellation.intent}, no side effect`,
);

// Exactly two intents may execute, and they are the two intended ones.
const executing = AGENT_INTENTS.filter(intentPermitsSideEffect);
check("A13", executing.join(",") === "EXECUTE,ESCALATE", `executing intents = ${executing.join(",")}`);
const humanOnly = AGENT_INTENTS.filter(intentIsHumanOnly);
check("A14", humanOnly.join(",") === "APPROVE,REJECT", `human-only intents = ${humanOnly.join(",")}`);

console.log("\n=== B. Intent enforced at plan validation (§8) ===\n");

initAgentRegistry();

// A read step under a read-only intent: MUST BE ALLOWED. This is the negative control — without
// it, "the write was refused" would also pass against a validator that refuses everything.
const readUnderExplain = validatePlan(
  "support",
  plan("ticket.context", { ticketId: "t1" }),
  resolveIntent({ goal: "Why was this ticket delayed?" }),
);
check("B1", readUnderExplain.ok, "read step under EXPLAIN is ALLOWED (negative control)");

// The same agent, same capability set, a write step under the same read-only intent: refused.
const writeUnderExplain = validatePlan(
  "support",
  plan("ticket.resolve", { ticketId: "t1", resolution: "done" }),
  resolveIntent({ goal: "Why was this ticket delayed?" }),
);
check(
  "B2",
  !writeUnderExplain.ok && writeUnderExplain.code === "INTENT_FORBIDS_SIDE_EFFECT",
  `write step under EXPLAIN -> ${writeUnderExplain.ok ? "ALLOWED" : writeUnderExplain.code}`,
);

// The same write under an executing intent: allowed. Proves the refusal is about the INTENT and
// not about the capability being unreachable for some other reason.
const writeUnderExecute = validatePlan(
  "support",
  plan("ticket.resolve", { ticketId: "t1", resolution: "done" }),
  resolveIntent({ goal: "Resolve ticket t1 as duplicate" }),
);
check("B3", writeUnderExecute.ok, "the same write under EXECUTE is ALLOWED (negative control)");

const writeUnderApprove = validatePlan(
  "support",
  plan("ticket.resolve", { ticketId: "t1", resolution: "done" }),
  resolveIntent({ goal: "Approve this ticket resolution" }),
);
check(
  "B4",
  !writeUnderApprove.ok && writeUnderApprove.code === "INTENT_HUMAN_ONLY",
  `write under APPROVE -> ${writeUnderApprove.ok ? "ALLOWED" : writeUnderApprove.code}`,
);

// Backwards compatibility: callers that pass no intent are unaffected.
const noIntent = validatePlan("support", plan("ticket.resolve", { ticketId: "t1", resolution: "d" }));
check("B5", noIntent.ok, "omitting the intent leaves existing validation behaviour unchanged");

console.log("\n=== C. Clarification (§9) ===\n");

const missingTicket = validatePlan(
  "support",
  plan("ticket.resolve", { resolution: "done" }),
  resolveIntent({ goal: "Resolve the ticket" }),
);
check(
  "C1",
  !missingTicket.ok && missingTicket.code === "NEEDS_CLARIFICATION",
  `missing required argument -> ${missingTicket.ok ? "ALLOWED" : missingTicket.code}`,
);
if (!missingTicket.ok && missingTicket.code === "NEEDS_CLARIFICATION") {
  check(
    "C2",
    missingTicket.questions.length === 1 && missingTicket.questions[0].field === "ticketId",
    `asks for exactly the missing field: ${missingTicket.questions.map((q) => q.field).join(",")}`,
  );
  check(
    "C3",
    /which ticket/i.test(missingTicket.questions[0].question),
    `the question is specific: "${missingTicket.questions[0].question}"`,
  );
}

// An empty string is missing, not supplied. A guess built on "" would run against nothing.
const blankTicket = validatePlan(
  "support",
  plan("ticket.resolve", { ticketId: "   ", resolution: "done" }),
  resolveIntent({ goal: "Resolve the ticket" }),
);
check(
  "C4",
  !blankTicket.ok && blankTicket.code === "NEEDS_CLARIFICATION",
  "a blank required argument counts as missing",
);

// A fully specified plan is NOT asked about. The negative control for the whole section.
const complete = validatePlan(
  "support",
  plan("ticket.resolve", { ticketId: "t1", resolution: "done" }),
  resolveIntent({ goal: "Resolve ticket t1" }),
);
check("C5", complete.ok, "a complete plan asks no questions (negative control)");

// Ordering: a plan that is BOTH unauthorised and underspecified reports the authorisation
// problem. Asking an operator to clarify a step that was never going to run wastes their time.
const unknownAndIncomplete = validatePlan(
  "support",
  plan("finance.summary", {}),
  resolveIntent({ goal: "Show me the finance summary" }),
);
check(
  "C6",
  !unknownAndIncomplete.ok && unknownAndIncomplete.code === "UNKNOWN_CAPABILITY",
  `cross-agent capability reports UNKNOWN_CAPABILITY, not a clarification -> ${
    unknownAndIncomplete.ok ? "ALLOWED" : unknownAndIncomplete.code
  }`,
);

console.log("\n=== D. Freshness (§35) ===\n");

const now = Date.now();

check(
  "D1",
  assessFreshness({ result: {}, maxAgeMs: undefined }).verdict === "NOT_REQUIRED",
  "no declared policy -> NOT_REQUIRED",
);

const fresh = assessFreshness({
  result: { freshness: new Date(now - 10_000).toISOString() },
  maxAgeMs: 300_000,
  now,
});
check("D2", fresh.verdict === "FRESH", `10s old against a 300s window -> ${fresh.verdict}`);

const stale = assessFreshness({
  result: { freshness: new Date(now - 600_000).toISOString() },
  maxAgeMs: 300_000,
  now,
});
check("D3", stale.verdict === "STALE", `600s old against a 300s window -> ${stale.verdict}`);

const undatable = assessFreshness({ result: { data: { zones: [] } }, maxAgeMs: 300_000, now });
check("D4", undatable.verdict === "UNKNOWN", "a payload with no timestamp -> UNKNOWN, not FRESH");

check("D5", blocksDownstreamWrite(stale), "STALE blocks a downstream write");
check("D6", blocksDownstreamWrite(undatable), "UNKNOWN blocks a downstream write");
check("D7", !blocksDownstreamWrite(fresh), "FRESH does not block (negative control)");
check(
  "D8",
  !blocksDownstreamWrite({ verdict: "NOT_REQUIRED" }),
  "NOT_REQUIRED does not block (negative control)",
);

/**
 * The field-priority test, and the reason the whole gate is not vacuous.
 *
 * `geo-intelligence`'s `intel()` wrapper stamps `generatedAt` AFTER the cache read, so it is the
 * SERVE time — a 180s-cached result always reports as generated a moment ago. `freshness` is set
 * inside the cached builder and survives the cache hit, so it is the real computation time.
 * Preferring `generatedAt` would make every cached read look brand new and this control would
 * never fire once.
 */
const bothFields = assessFreshness({
  result: {
    freshness: new Date(now - 600_000).toISOString(),
    generatedAt: new Date(now - 1_000).toISOString(),
  },
  maxAgeMs: 300_000,
  now,
});
check(
  "D9",
  bothFields.verdict === "STALE" && bothFields.field === "freshness",
  `prefers 'freshness' over serve-time 'generatedAt' -> ${bothFields.verdict} via ${bothFields.field}`,
);

// Nested payloads: the city twin returns { data: { layers }, freshness }.
const nested = assessFreshness({
  result: { data: { layers: { demand: {} } }, freshness: new Date(now - 20_000).toISOString() },
  maxAgeMs: 300_000,
  now,
});
check("D10", nested.verdict === "FRESH" && nested.field === "freshness", "envelope timestamp is found");

// A future timestamp is UNKNOWN. "The data is from the future" must never be why a write ran.
const future = assessFreshness({
  result: { freshness: new Date(now + 600_000).toISOString() },
  maxAgeMs: 300_000,
  now,
});
check("D11", future.verdict === "UNKNOWN", `a future timestamp -> ${future.verdict}, not FRESH`);

// Small negative ages are ordinary clock skew and must not read as UNKNOWN.
const skew = assessFreshness({
  result: { freshness: new Date(now + 200).toISOString() },
  maxAgeMs: 300_000,
  now,
});
check("D12", skew.verdict === "FRESH", "200ms of clock skew is absorbed, not flagged");

// A bare number is not accepted as a timestamp. Guessing wrong produces a confident age that is
// off by decades, which reads as FRESH or STALE with equal conviction.
const numeric = assessFreshness({ result: { readAt: 1_700_000_000_000 }, maxAgeMs: 300_000, now });
check("D13", numeric.verdict === "UNKNOWN", "a bare epoch number is not treated as a timestamp");

console.log("\n=== E. Registry integrity after the capability additions ===\n");

const defs = listAgentDefinitions();
check("E1", defs.length === 5, `${defs.length} agents defined`);

/**
 * 32 = the 22 that existed before this pass, plus the 10 added from the service-layer walk:
 * support +3 (search, analytics, escalate), operations +2 (coverage, cityTwin),
 * partner-operations +1 (roster), finance +3 (payoutHealth, payoutQueue, anomalies),
 * fraud +1 (highRiskUsers).
 */
const capCount = defs.reduce((n, d) => n + d.capabilities.length, 0);
check("E2", capCount === 32, `${capCount} capabilities across the fleet`);

const readOnlyWrites = defs
  .filter((d) => d.readOnly)
  .flatMap((d) => d.capabilities.filter((c) => c.risk !== "LOW").map((c) => `${d.agentId}:${c.name}`));
check("E3", readOnlyWrites.length === 0, `read-only agents declare 0 non-LOW capabilities`);

const writesWithoutPostCondition = defs
  .flatMap((d) => d.capabilities.map((c) => ({ d, c })))
  .filter(({ c }) => c.risk !== "LOW" && !c.postCondition);
check("E4", writesWithoutPostCondition.length === 0, "every write declares a post-condition");

// Every capability carrying a freshness policy must be able to produce a non-vacuous answer.
// A policy on a capability whose only timestamp is stamped by its own handler is theatre.
const withFreshness = defs
  .flatMap((d) => d.capabilities.map((c) => ({ agent: d.agentId, c })))
  .filter(({ c }) => c.freshness);
check(
  "E5",
  withFreshness.length === 4,
  `freshness policies declared on ${withFreshness.length} capabilities: ${withFreshness
    .map((x) => x.c.name)
    .join(", ")}`,
);
check(
  "E6",
  withFreshness.every(({ c }) => c.risk === "LOW"),
  "freshness policies sit on reads, which is where evidence comes from",
);

console.log(`\n${"=".repeat(60)}`);
console.log(`  ${pass} PASS   ${fail} FAIL`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
console.log(`${"=".repeat(60)}\n`);

process.exit(fail === 0 ? 0 : 1);
