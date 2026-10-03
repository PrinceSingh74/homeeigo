/**
 * Tool execution error types.
 *
 * Deliberately dependency-free. `execution-engine` → `tool-registry` → `handlers` is already a
 * cycle, so a handler importing these from the engine would deepen it; both sides import this
 * leaf module instead.
 */

/**
 * A business rule refused the action — the tool worked correctly and nothing is broken.
 *
 * Distinct from `ToolExecutionError` because the two must be treated differently. A domain
 * rejection like ALREADY_CLAIMED (two partners raced for one job) or PAYMENT_NOT_SETTLED is a
 * NORMAL outcome; counting it toward the circuit breaker would let five ordinary race losses
 * disable the tool for every partner for a minute, and retrying it just asks the same question
 * again. It is still not a success: the execution is recorded FAILED with the domain's own code,
 * so the audit, the metrics and the AI's answer all say the action did not happen.
 */
export class ToolDomainRejection extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "ToolDomainRejection";
  }
}
