import crypto from "crypto";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { maxQuietDeferralMs } from "../../notifications/governance/quiet-hours";
import type { WorkflowDefinitionInput, WorkflowStep } from "../types";

/**
 * The workflow registry — code is the source of definitions, the database is the record of what
 * was activated.
 *
 * Version immutability is the point of this module. Once a version is activated its steps are
 * frozen: a code change that alters an activated version is rejected at boot rather than silently
 * rewriting the definition that running instances are pinned to. An instance that waited two hours
 * under v1 must act under v1, not under whatever v1 was edited into while it slept.
 *
 * Changing a live workflow is therefore done by publishing v2, never by editing v1.
 */

const registry = new Map<string, WorkflowDefinitionInput>();

const key = (workflowId: string, version: number) => `${workflowId}.v${version}`;

/**
 * Rewrites a value with object keys in a fixed order, leaving arrays exactly as they are.
 *
 * The stored column is `jsonb`, which does not keep the key order it was given — it sorts keys by
 * length and then alphabetically. `{id, type, notificationType, recipient}` comes back as
 * `{id, type, recipient, notificationType}`, identical in meaning and different as text.
 *
 * Hashing the text directly therefore compared a definition against a reordered copy of itself and
 * declared it changed. The consequence was not a wrong fingerprint in the abstract: the immutability
 * check treats a mismatch as someone having edited an activated workflow and refuses to boot. Once
 * any workflow with three or more step fields was activated, the next restart would have failed —
 * and the error would have accused a developer of editing something nobody had touched.
 *
 * Array order is deliberately untouched. Step order is behaviour, and swapping two steps must still
 * read as a different definition.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonicalize((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Stable fingerprint of a version's behaviour, invariant to how the store happened to order keys. */
export function fingerprintSteps(steps: WorkflowStep[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(steps))).digest("hex").slice(0, 32);
}

export function registerWorkflow(definition: WorkflowDefinitionInput): void {
  const id = key(definition.workflowId, definition.version);
  if (registry.has(id)) {
    throw new Error(`Workflow ${id} is already registered — publish a new version instead`);
  }
  if (definition.steps.length === 0) {
    throw new Error(`Workflow ${id} has no steps`);
  }
  const ids = definition.steps.map((s) => s.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Workflow ${id} has duplicate step ids`);
  }
  if (definition.maxSteps < definition.steps.length) {
    throw new Error(`Workflow ${id} maxSteps (${definition.maxSteps}) is below its own step count`);
  }

  /**
   * A workflow that can message people must be able to outlive a night.
   *
   * `maxAgeMs` is measured from the instance's creation and checked before every step, so a
   * workflow created at 21:15 with a one-hour budget would be woken at 08:00 only to be discarded
   * as too old. Nothing would appear broken — the instance would end tidily as MAX_AGE_EXCEEDED —
   * and the notification would simply never arrive.
   *
   * Rejecting that at registration is deliberate: a definition whose age budget cannot span its own
   * quiet window is not a workflow with an edge case, it is a workflow that silently cannot send.
   * Better to be told while writing it than to find out from a customer who was never contacted.
   */
  const hasNotification = definition.steps.some((s) => s.type === "NOTIFICATION");
  if (hasNotification) {
    const required = maxQuietDeferralMs();
    if (definition.maxAgeMs < required) {
      throw new Error(
        `Workflow ${id} has a NOTIFICATION step but maxAgeMs (${Math.round(definition.maxAgeMs / 60_000)}min) ` +
          `is shorter than the quiet-hours window it may be deferred across ` +
          `(${Math.round(required / 60_000)}min) — such an instance would expire before it could resume`,
      );
    }
  }

  registry.set(id, definition);
}

export function getWorkflow(workflowId: string, version: number): WorkflowDefinitionInput | undefined {
  return registry.get(key(workflowId, version));
}

export function listWorkflows(): WorkflowDefinitionInput[] {
  return [...registry.values()];
}

/** Test-only: reset between cases. */
export function clearWorkflows(): void {
  registry.clear();
}

/**
 * Reconciles the in-code registry with the database.
 *
 * A version that has never been activated is written or refreshed. A version that HAS been
 * activated is compared, and a mismatch is a hard failure: it means someone edited a definition
 * that instances are already running under. Refusing to boot is the correct response — the
 * alternative is a fleet of instances quietly changing behaviour mid-flight.
 */
export async function syncWorkflowDefinitions(): Promise<{ created: number; updated: number; unchanged: number }> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const def of registry.values()) {
    const existing = await prisma.workflowDefinition.findUnique({
      where: { workflowId_version: { workflowId: def.workflowId, version: def.version } },
    });

    if (!existing) {
      await prisma.workflowDefinition.create({
        data: {
          workflowId: def.workflowId,
          version: def.version,
          name: def.name,
          trigger: def.trigger,
          steps: def.steps as unknown as object,
          maxAgeMs: def.maxAgeMs,
          maxSteps: def.maxSteps,
          metadata: (def.metadata ?? {}) as object,
        },
      });
      created++;
      continue;
    }

    if (existing.activatedAt) {
      const stored = fingerprintSteps(existing.steps as unknown as WorkflowStep[]);
      const current = fingerprintSteps(def.steps);
      if (stored !== current) {
        throw new Error(
          `Workflow ${key(def.workflowId, def.version)} was activated on ${existing.activatedAt.toISOString()} ` +
            `and its steps have since changed. Activated versions are immutable — publish v${def.version + 1} instead.`,
        );
      }
      unchanged++;
      continue;
    }

    await prisma.workflowDefinition.update({
      where: { id: existing.id },
      data: {
        name: def.name,
        trigger: def.trigger,
        steps: def.steps as unknown as object,
        maxAgeMs: def.maxAgeMs,
        maxSteps: def.maxSteps,
        metadata: (def.metadata ?? {}) as object,
      },
    });
    updated++;
  }

  logger.info("workflow_definitions_synced", { created, updated, unchanged });
  return { created, updated, unchanged };
}

/** Marks a version live. After this the definition can no longer change (see sync above). */
export async function activateWorkflow(workflowId: string, version: number): Promise<void> {
  const def = getWorkflow(workflowId, version);
  if (!def) throw new Error(`Workflow ${key(workflowId, version)} is not registered in code`);

  await prisma.workflowDefinition.update({
    where: { workflowId_version: { workflowId, version } },
    data: { status: "ACTIVE", activatedAt: new Date() },
  });
  logger.info("workflow_activated", { workflowId, version });
}

/**
 * The version new instances should use: the highest ACTIVE one.
 *
 * Deliberately a lookup rather than "latest registered" — activating v2 must not disturb v1
 * instances already running, and a v2 that is still DRAFT must not start catching triggers.
 */
export async function resolveActiveVersion(workflowId: string): Promise<number | null> {
  const row = await prisma.workflowDefinition.findFirst({
    where: { workflowId, status: "ACTIVE" },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return row?.version ?? null;
}
