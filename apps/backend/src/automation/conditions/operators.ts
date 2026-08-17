import { CONDITION_REASON, type ConditionReason, type Operator } from "./types";

/**
 * Typed comparison. Nothing is coerced.
 *
 * `"5" > 3` is a bug wearing a disguise, and in an automation it is a bug that sends a real
 * message to a real person. Every operand pair whose types do not line up is refused as
 * TYPE_MISMATCH rather than guessed at, and a refusal never passes.
 */

export type OperatorOutcome = { passed: boolean; reason: ConditionReason };

function ordered(actual: unknown, expected: unknown, cmp: (a: number, b: number) => boolean): OperatorOutcome {
  // Dates are ordered too, but only against dates — never against a timestamp number, because
  // "is this greater" then depends on which unit someone happened to write.
  if (actual instanceof Date && expected instanceof Date) {
    return { passed: cmp(actual.getTime(), expected.getTime()), reason: CONDITION_REASON.PASSED };
  }
  // Checked inline rather than through a helper: a single type predicate can only narrow one
  // parameter, and both operands have to be known numbers before they are compared.
  if (typeof actual !== "number" || typeof expected !== "number") {
    return { passed: false, reason: CONDITION_REASON.TYPE_MISMATCH };
  }
  return { passed: cmp(actual, expected), reason: CONDITION_REASON.PASSED };
}

/** Structural equality for the value shapes a resolver can return. */
function equal(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

export function applyOperator(operator: Operator, actual: unknown, expected: unknown): OperatorOutcome {
  switch (operator) {
    case "exists":
      return { passed: actual !== null && actual !== undefined, reason: CONDITION_REASON.PASSED };
    case "notExists":
      return { passed: actual === null || actual === undefined, reason: CONDITION_REASON.PASSED };

    case "equals":
      return { passed: equal(actual, expected), reason: CONDITION_REASON.PASSED };
    case "notEquals":
      return { passed: !equal(actual, expected), reason: CONDITION_REASON.PASSED };

    case "greaterThan":
      return ordered(actual, expected, (a, b) => a > b);
    case "lessThan":
      return ordered(actual, expected, (a, b) => a < b);
    case "greaterThanOrEqual":
      return ordered(actual, expected, (a, b) => a >= b);
    case "lessThanOrEqual":
      return ordered(actual, expected, (a, b) => a <= b);

    case "in": {
      if (!Array.isArray(expected)) return { passed: false, reason: CONDITION_REASON.TYPE_MISMATCH };
      return { passed: expected.some((candidate) => equal(actual, candidate)), reason: CONDITION_REASON.PASSED };
    }

    default:
      return { passed: false, reason: CONDITION_REASON.MALFORMED };
  }
}
