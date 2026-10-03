/**
 * PRODUCTION FEATURE FLAG BOOTSTRAP.
 *
 * Creates the Phase-15 flag rows **disabled**, so a canary has something to turn on one capability
 * at a time. Before this existed the only options were "unreachable" and "on for everyone".
 *
 * Three deliberate refusals:
 *
 *  1. It will not run without a valid production authorization. Creating flag rows is a production
 *     write, and the fact that they are created OFF does not make it not one.
 *  2. It will not enable anything. There is no `--enable` flag here on purpose: enabling is a
 *     canary decision made while watching metrics, not a bootstrap step.
 *  3. It refuses to guess the environment. `platform_feature_flags` is looked up by
 *     `{ key, environment }`, so a row written with the wrong environment string is invisible and
 *     the capability stays silently off — a failure mode that looks exactly like success.
 *
 *   bun --env-file=.env run scripts/release/bootstrap-production-flags.ts            # preview
 *   bun --env-file=.env run scripts/release/bootstrap-production-flags.ts --execute  # writes rows
 */
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { currentEnvironment, invalidateFlagCache } from "../../src/services/feature-flag.service";
import { SIMULATION_FEATURE_FLAG } from "../../src/services/scenario-simulation.service";
import { WORKFLOW_DRAFT_FEATURE_FLAG } from "../../src/services/ai-workflow-draft.service";

const AUTH_FILE = join(resolve(import.meta.dir, "../../../.."), ".production-authorization.json");
const REQUIRED_STATEMENT =
  "I authorize this production release and accept responsibility for the migrations listed above.";

const FLAGS = [
  {
    key: SIMULATION_FEATURE_FLAG,
    description: "Phase-15 scenario simulation and executive what-if (admin/executive only)",
  },
  {
    key: WORKFLOW_DRAFT_FEATURE_FLAG,
    description: "Phase-15 AI-assisted workflow drafting (draft creation; review stays available)",
  },
] as const;

const execute = process.argv.includes("--execute");

if (!existsSync(AUTH_FILE)) {
  console.log("RELEASE_BLOCKED_AUTHORIZATION");
  console.log(`No authorization at ${AUTH_FILE}. Creating flag rows is a production write.`);
  process.exit(1);
}

let auth: { statement?: string; authorizedBy?: string; authorizedAt?: string };
try {
  auth = JSON.parse(readFileSync(AUTH_FILE, "utf8"));
} catch (err) {
  console.log("RELEASE_BLOCKED_AUTHORIZATION");
  console.log(`Authorization file is not valid JSON: ${String(err).slice(0, 120)}`);
  process.exit(1);
}

if (auth.statement !== REQUIRED_STATEMENT) {
  console.log("RELEASE_BLOCKED_AUTHORIZATION");
  console.log("The authorization statement does not match exactly.");
  process.exit(1);
}

const ageHours = (Date.now() - new Date(auth.authorizedAt ?? "").getTime()) / 3600_000;
if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > 24) {
  console.log("RELEASE_BLOCKED_AUTHORIZATION");
  console.log("The authorization is expired, undated, or dated in the future.");
  process.exit(1);
}

const env = currentEnvironment();
console.log(`feature flag bootstrap — environment "${env}"`);
console.log(`authorized by ${auth.authorizedBy}`);
console.log(execute ? "mode: EXECUTE" : "mode: PREVIEW (nothing will be written)");
console.log("");

/**
 * ALLOW-LIST, not a deny-list. The first version of this guard listed the environments to refuse
 * ("development", "test") and let everything else through. `currentEnvironment()` returned "dev" --
 * not on that list -- so the guard passed and two flag rows were written to the live database by a
 * run that was only meant to prove the guard worked.
 *
 * A deny-list of environment names cannot be complete, because the name is whatever APP_ENV happens
 * to hold. Naming the environments that ARE production fails closed on every string nobody thought
 * of, which is the only safe direction for a check standing in front of a production write.
 */
const PRODUCTION_ENVIRONMENTS = ["production", "prod"];
if (execute && !PRODUCTION_ENVIRONMENTS.includes(env.toLowerCase())) {
  console.log(`REFUSING: environment resolves to "${env}", which is not a production environment.`);
  console.log(`Expected one of: ${PRODUCTION_ENVIRONMENTS.join(", ")}.`);
  console.log("Run this against the deployed runtime, or set APP_ENV to match it.");
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL ?? "" } } });

for (const flag of FLAGS) {
  const existing = await prisma.platformFeatureFlag.findUnique({ where: { key: flag.key } });

  if (existing) {
    console.log(
      `  EXISTS  ${flag.key} — enabled=${existing.enabled}, rollout=${existing.rolloutPct}%, env=${existing.environment}`,
    );
    if (existing.environment !== env) {
      console.log(
        `          WARNING: row environment "${existing.environment}" does not match "${env}" — the runtime will not see it`,
      );
    }
    continue;
  }

  if (!execute) {
    console.log(`  WOULD CREATE  ${flag.key} — enabled=false, rollout=0%, env=${env}`);
    continue;
  }

  await prisma.platformFeatureFlag.create({
    data: {
      key: flag.key,
      description: flag.description,
      enabled: false,
      rolloutPct: 0,
      environment: env,
      isKillSwitch: false,
      updatedBy: auth.authorizedBy ?? "release-bootstrap",
    },
  });
  await invalidateFlagCache(flag.key);
  console.log(`  CREATED  ${flag.key} — enabled=false, rollout=0%, env=${env}`);
}

console.log("");
console.log(
  execute
    ? "Flags exist and are OFF. Enable ONE, call invalidateFlagCache, watch, then raise rollout_pct."
    : "Preview only. Re-run with --execute to create the rows.",
);
console.log("A flag change without cache invalidation takes up to 30 seconds to take effect.");
await prisma.$disconnect();
