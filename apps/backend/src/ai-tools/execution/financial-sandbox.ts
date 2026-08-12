/**
 * Phase 5A — the gate that lets exactly one high-risk tool execute, and only in a sandbox.
 *
 * Phase 5 froze every high-risk tool at zero handlers: `registerToolHandlers` discarded the
 * handler for anything in the HIGH_RISK category, so an approved request consumed its approval
 * and then stopped at NO_HANDLER. That is the correct default and it stays the default. This
 * module is the narrow, explicit exception — it names the tools allowed to bind a handler and
 * states the conditions under which one may run.
 *
 * The three conditions are deliberately independent, and each one alone is sufficient to refuse:
 *
 *   1. Not production. A `NODE_ENV` of "production" refuses unconditionally — there is no flag
 *      that overrides this, because the flag is exactly what a misconfigured deploy gets wrong.
 *   2. Explicitly enabled. Off unless `AI_TOOLS_FINANCIAL_SANDBOX=true` is set. Absent means off;
 *      no default opens it.
 *   3. The payment gateway is in test mode. A refund ultimately reaches Razorpay with whatever
 *      key the process holds, and `razorpayService` does not distinguish test from live. So this
 *      checks the key prefix directly: `rzp_test_` and nothing else. A live key cannot be used to
 *      satisfy a sandbox run even if the first two conditions pass.
 *
 * Every check reads `process.env` at call time rather than at import. A value captured at module
 * load would let a process that started in a sandbox keep executing refunds after the environment
 * around it changed, and would make the gate untestable without reimporting the module.
 */

/**
 * High-risk tools permitted to bind a handler at all. Membership here is necessary but not
 * sufficient — {@link financialSandboxVerdict} still has to allow the run.
 */
export const SANDBOX_HIGH_RISK_ALLOWLIST: ReadonlySet<string> = new Set(["high_risk.finance.refund"]);

export type SandboxVerdict = { allowed: true } | { allowed: false; reason: SandboxRefusal };

export type SandboxRefusal =
  /** `NODE_ENV=production`. Nothing overrides this. */
  | "PRODUCTION_ENVIRONMENT"
  /** `AI_TOOLS_FINANCIAL_SANDBOX` is not exactly "true". */
  | "SANDBOX_DISABLED"
  /** `RAZORPAY_KEY_ID` is missing or is not an `rzp_test_` key. */
  | "GATEWAY_NOT_IN_TEST_MODE";

/** Whether a high-risk tool is even eligible for a handler binding. */
export function isSandboxExecutableHighRiskTool(toolId: string): boolean {
  return SANDBOX_HIGH_RISK_ALLOWLIST.has(toolId);
}

/**
 * Whether financial execution may run right now.
 *
 * Returns a reason rather than a bare boolean so the refusal can be recorded and read back —
 * "the sandbox is off" and "someone pointed a live gateway key at it" are very different
 * operational events and must not collapse into one error.
 */
export function financialSandboxVerdict(): SandboxVerdict {
  if (process.env.NODE_ENV === "production") {
    return { allowed: false, reason: "PRODUCTION_ENVIRONMENT" };
  }
  if (process.env.AI_TOOLS_FINANCIAL_SANDBOX !== "true") {
    return { allowed: false, reason: "SANDBOX_DISABLED" };
  }
  if (!(process.env.RAZORPAY_KEY_ID ?? "").startsWith("rzp_test_")) {
    return { allowed: false, reason: "GATEWAY_NOT_IN_TEST_MODE" };
  }
  return { allowed: true };
}

/** Convenience for reporting and health surfaces. Never includes any credential value. */
export function financialSandboxStatus(): {
  allowed: boolean;
  reason?: SandboxRefusal;
  allowlist: string[];
} {
  const verdict = financialSandboxVerdict();
  return {
    allowed: verdict.allowed,
    ...(verdict.allowed ? {} : { reason: verdict.reason }),
    allowlist: [...SANDBOX_HIGH_RISK_ALLOWLIST],
  };
}
