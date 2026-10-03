/**
 * One answer to "is this a real deployment, or a developer's laptop?".
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 *
 * `.env.staging` ships **NODE_ENV=development** with APP_ENV=staging. So `NODE_ENV !== "production"`
 * — the obvious way to write "only in dev" — is TRUE on staging, and every affordance written that
 * way is live on a host with real-looking accounts and real integrations.
 *
 * That has been found and fixed three separate times, each in isolation:
 *
 *   - `ops-auth.ts`      — a staging host served its financial metrics to anyone who asked;
 *   - `payment-mocks.ts` — any customer could mark their own booking paid with ₹0 moved;
 *   - `routes/auth.ts`   — a live password-reset token printed to the console, and an auth
 *                          burst-limit bypass any caller could claim by choosing their e-mail
 *                          domain (found in Pass 5).
 *
 * Three copies of one predicate is how the fourth site gets missed. The two earlier copies now
 * delegate here, so the rule is stated once and fixing it fixes everything.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Deployed = NODE_ENV=production, OR APP_ENV in {production, staging}. Anything else is a local
 * machine or a test runner.
 *
 * Deliberately an allowlist of *safe* environments rather than a deny-list of dangerous ones: an
 * unrecognised or misspelled APP_ENV must not silently grant dev affordances, which is the same
 * reasoning `agents/config.ts` already applies to agent execution.
 */
/** APP_ENV values that mean a developer machine or a test/chaos runner. Unset counts as local. */
const LOCAL_APP_ENVS: ReadonlySet<string> = new Set(["", "dev", "development", "local", "test", "chaos"]);

export function isDeployedEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return true;
  const appEnv = (env.APP_ENV ?? "").trim().toLowerCase();
  return appEnv === "production" || appEnv === "staging";
}

/**
 * A KNOWN developer machine or test/chaos runner — the only place dev affordances are allowed.
 *
 * Not simply `!isDeployedEnvironment()` (2026-10-01). An unrecognised APP_ENV (`stagng`, `preprod`,
 * `uat`) is neither known-deployed nor known-local, and the two questions must fail safe in OPPOSITE
 * directions: such a host gets no deployed-only GRANT (e.g. warehouse egress keys off
 * isDeployedEnvironment) and no dev AFFORDANCE either (payment mocks, OTPs in responses, LAN CORS).
 * Before this split an unknown value counted as a laptop and switched every affordance on — the
 * opposite of what the rule above promises.
 */
export function isKnownLocalEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === "production") return false;
  return LOCAL_APP_ENVS.has((env.APP_ENV ?? "").trim().toLowerCase());
}

/**
 * Whether a convenience that must never reach a deployed host is permitted.
 *
 * Read this as the question to ask before echoing a secret to a log, skipping a rate limit, minting
 * a signature, or short-circuiting a verification: "is it safe to do this here?" — never
 * `NODE_ENV !== "production"`.
 */
export function devAffordancesAllowed(): boolean {
  return isKnownLocalEnvironment();
}
