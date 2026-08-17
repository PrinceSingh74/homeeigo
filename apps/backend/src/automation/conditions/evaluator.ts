import { applyOperator } from "./operators";
import { resolveField } from "./resolver-registry";
import {
  CONDITION_REASON,
  OPERATORS,
  type Comparison,
  type Condition,
  type ConditionResult,
  type Operator,
  type SubjectRef,
} from "./types";

/**
 * Walks a condition tree and decides whether it holds — right now, for this subject.
 *
 * Everything here fails closed. An unknown field, a denied subject, a type mismatch, stale data, a
 * malformed branch, a resolver that throws — none of them pass. The reason is that a condition is
 * the last thing standing between an automation and a real person: the only safe interpretation of
 * "I could not determine whether this was true" is "do not act".
 *
 * The trail of every field evaluated is returned alongside the verdict, so the audit can answer
 * not just whether the condition passed but which part of it decided.
 */

type Trail = NonNullable<ConditionResult["evaluated"]>;

function isComparison(c: Condition): c is Comparison {
  return typeof (c as Comparison).field === "string";
}

async function evaluateComparison(c: Comparison, subject: SubjectRef, trail: Trail): Promise<ConditionResult> {
  if (!OPERATORS.includes(c.operator as Operator)) {
    trail.push({ field: c.field, operator: c.operator, passed: false, reason: CONDITION_REASON.MALFORMED });
    return { passed: false, reason: CONDITION_REASON.MALFORMED, detail: `unknown operator "${c.operator}"`, evaluated: trail };
  }

  const outcome = await resolveField(subject, c.field);
  if (!outcome.ok) {
    trail.push({ field: c.field, operator: c.operator, passed: false, reason: outcome.reason });
    return { passed: false, reason: outcome.reason, detail: outcome.detail, evaluated: trail };
  }

  const applied = applyOperator(c.operator, outcome.resolved.value, c.value);

  /**
   * The trail records the comparison's verdict, not the operator's application status.
   *
   * `applyOperator` returns PASSED to mean "the operands were comparable", which is a different
   * question from "did the comparison hold". Writing that straight into the audit produced entries
   * reading `passed: false, reason: PASSED`, which is exactly the kind of line that makes an
   * operator distrust the whole trail.
   */
  const verdict =
    applied.reason === CONDITION_REASON.TYPE_MISMATCH || applied.reason === CONDITION_REASON.MALFORMED
      ? applied.reason
      : applied.passed
        ? CONDITION_REASON.PASSED
        : CONDITION_REASON.FAILED;
  trail.push({ field: c.field, operator: c.operator, passed: applied.passed, reason: verdict });

  if (applied.reason === CONDITION_REASON.TYPE_MISMATCH || applied.reason === CONDITION_REASON.MALFORMED) {
    return {
      passed: false,
      reason: applied.reason,
      detail: `${c.field} ${c.operator} ${JSON.stringify(c.value)} — got ${JSON.stringify(outcome.resolved.value)}`,
      evaluated: trail,
    };
  }

  return {
    passed: applied.passed,
    reason: applied.passed ? CONDITION_REASON.PASSED : CONDITION_REASON.FAILED,
    detail: `${c.field} ${c.operator} ${JSON.stringify(c.value)} → ${JSON.stringify(outcome.resolved.value)}`,
    evaluated: trail,
  };
}

async function walk(c: Condition, subject: SubjectRef, trail: Trail, depth: number): Promise<ConditionResult> {
  // A condition tree is authored in code and reviewed, but a bound is still cheap insurance
  // against a definition that accidentally references itself.
  if (depth > 12) {
    return { passed: false, reason: CONDITION_REASON.MALFORMED, detail: "condition nested too deeply", evaluated: trail };
  }

  if (isComparison(c)) return evaluateComparison(c, subject, trail);

  if ("and" in c) {
    // Empty is malformed, not vacuously true — "all of nothing" passing would let an empty
    // condition wave an action through.
    if (!Array.isArray(c.and) || c.and.length === 0) {
      return { passed: false, reason: CONDITION_REASON.MALFORMED, detail: "empty AND", evaluated: trail };
    }
    for (const child of c.and) {
      const r = await walk(child, subject, trail, depth + 1);
      if (!r.passed) return { ...r, evaluated: trail };   // short-circuit, and keep the failing reason
    }
    return { passed: true, reason: CONDITION_REASON.PASSED, evaluated: trail };
  }

  if ("or" in c) {
    if (!Array.isArray(c.or) || c.or.length === 0) {
      return { passed: false, reason: CONDITION_REASON.MALFORMED, detail: "empty OR", evaluated: trail };
    }
    let lastReason: ConditionResult["reason"] = CONDITION_REASON.FAILED;
    let lastDetail: string | undefined;
    for (const child of c.or) {
      const r = await walk(child, subject, trail, depth + 1);
      if (r.passed) return { passed: true, reason: CONDITION_REASON.PASSED, evaluated: trail };
      lastReason = r.reason;
      lastDetail = r.detail;
    }
    return { passed: false, reason: lastReason, detail: lastDetail, evaluated: trail };
  }

  if ("not" in c) {
    const r = await walk(c.not, subject, trail, depth + 1);
    /**
     * NOT inverts a verdict, never an error.
     *
     * If the child could not be determined — unknown field, denied subject, stale data — negating
     * it would turn "I don't know" into "true", which is precisely the failure this engine exists
     * to prevent. Only a clean PASSED/FAILED is invertible.
     */
    if (r.reason !== CONDITION_REASON.PASSED && r.reason !== CONDITION_REASON.FAILED) {
      return { ...r, passed: false, evaluated: trail };
    }
    return {
      passed: !r.passed,
      reason: !r.passed ? CONDITION_REASON.PASSED : CONDITION_REASON.FAILED,
      detail: r.detail ? `NOT(${r.detail})` : undefined,
      evaluated: trail,
    };
  }

  return { passed: false, reason: CONDITION_REASON.MALFORMED, detail: "unrecognised condition node", evaluated: trail };
}

export async function evaluateCondition(condition: Condition, subject: SubjectRef): Promise<ConditionResult> {
  try {
    return await walk(condition, subject, [], 0);
  } catch (err) {
    return {
      passed: false,
      reason: CONDITION_REASON.RESOLVER_ERROR,
      detail: err instanceof Error ? err.message.slice(0, 200) : "evaluation threw",
    };
  }
}
