import "../src/load-env";
import { evaluateFlag, isFeatureEnabled, PHASE7_FLAGS, bucketFor } from "../src/services/feature-flag.service";
import prisma from "../src/lib/prisma";

async function main() {
  console.log("=== STEP 3: FEATURE FLAG VERIFICATION (real evaluator, real DB) ===\n");
  let allPass = true;

  const flags = [
    PHASE7_FLAGS.AI_FOLLOW_UP,
    PHASE7_FLAGS.AI_REBOOKING,
    PHASE7_FLAGS.AI_SATISFACTION_INTELLIGENCE,
  ];

  // 1. Confirm no DB row exists yet for any of the three (honest starting state).
  const rows = await prisma.platformFeatureFlag.findMany({ where: { key: { in: flags } } });
  console.log("Existing DB rows for new flags:", rows.length, rows.length === 0 ? "(none — as expected)" : rows);

  // 2. Fail-closed default: with no row, isFeatureEnabled must be false for a real user id.
  const realUser = await prisma.user.findFirst({ where: { role: "CUSTOMER" }, select: { id: true } });
  if (!realUser) throw new Error("No real customer user found to test against");

  for (const flag of flags) {
    const decision = await evaluateFlag(flag, realUser.id);
    const enabled = await isFeatureEnabled(flag, realUser.id);
    console.log(`\n${flag}:`);
    console.log("  evaluateFlag:", JSON.stringify(decision));
    console.log("  isFeatureEnabled:", enabled);
    if (decision.enabled !== false || decision.reason !== "FLAG_MISSING" || enabled !== false) {
      console.log("  FAIL: expected disabled/FLAG_MISSING by default");
      allPass = false;
    } else {
      console.log("  PASS: fail-closed, OFF by default");
    }
  }

  // 3. Environment isolation: reading with a bogus env-scoped key must not find a prod row.
  const envBefore = process.env.APP_ENV;
  process.env.APP_ENV = "staging-test-isolation";
  const stagingDecision = await evaluateFlag(PHASE7_FLAGS.AI_REBOOKING, realUser.id);
  process.env.APP_ENV = envBefore;
  console.log("\nEnvironment isolation check (APP_ENV=staging-test-isolation):");
  console.log("  ", JSON.stringify(stagingDecision));
  if (stagingDecision.enabled !== false) {
    console.log("  FAIL: staging environment unexpectedly enabled");
    allPass = false;
  } else {
    console.log("  PASS: no cross-environment leak");
  }

  // 4. Rollout bucket determinism: same user+flag always yields the same bucket.
  const b1 = bucketFor(PHASE7_FLAGS.AI_FOLLOW_UP, realUser.id);
  const b2 = bucketFor(PHASE7_FLAGS.AI_FOLLOW_UP, realUser.id);
  console.log("\nRollout bucket determinism:", b1, "===", b2, b1 === b2 ? "PASS" : "FAIL");
  if (b1 !== b2) allPass = false;

  console.log(`\n=== ${allPass ? "ALL CHECKS PASS" : "FAILURES DETECTED"} ===`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
