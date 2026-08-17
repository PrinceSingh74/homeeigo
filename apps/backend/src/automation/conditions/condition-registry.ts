import type { Condition } from "./types";

/**
 * Named conditions, defined in code.
 *
 * A workflow step carries a `conditionId`, not a condition body — the same separation 6A uses for
 * workflow definitions. The frozen definition in the database therefore references a condition by
 * name and can never carry one, so editing a database row cannot change what a running workflow
 * checks.
 */

const registry = new Map<string, Condition>();

export function registerCondition(id: string, condition: Condition): void {
  if (registry.has(id)) throw new Error(`Condition "${id}" is already registered`);
  registry.set(id, condition);
}

export function getCondition(id: string): Condition | undefined {
  return registry.get(id);
}

export function listConditions(): string[] {
  return [...registry.keys()].sort();
}

/** Test-only: reset between cases. */
export function clearConditions(): void {
  registry.clear();
}

/** Conditions the first workflows need. Registered at boot alongside workflow definitions. */
export function registerAllConditions(): void {
  // Review request: ask only while the booking is still completed and still unrated.
  registerCondition("booking.completed_and_unrated", {
    and: [
      { field: "booking.status", operator: "equals", value: "COMPLETED" },
      { field: "rating.exists", operator: "equals", value: false },
    ],
  });

  // Payment recovery: the stop condition is the money arriving, however it arrived.
  registerCondition("payment.still_failed", {
    field: "payment.status",
    operator: "in",
    value: ["FAILED", "PENDING", "INITIATED"],
  });

  // Dispatch stall: assigned, but the partner has not set off yet.
  registerCondition("booking.assigned_not_en_route", {
    and: [
      { field: "booking.status", operator: "in", value: ["ACCEPTED", "ASSIGNED"] },
      { field: "booking.enRouteAt", operator: "notExists" },
    ],
  });
}
