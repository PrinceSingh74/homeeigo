import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { toInputJsonArray } from "../../lib/json-input";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { maxQuietDeferralMs } from "../../notifications/governance/quiet-hours";
import { HIGH_RISK_ACTIONS } from "../types";
import { assertLiveAllowed } from "./certification";
import { fingerprintFor } from "./capability-fingerprint";
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

/**
 * A definition's steps, reduced to something the Json column accepts — validated, not asserted.
 *
 * Throws rather than skipping: a workflow version written without its steps is not a smaller
 * problem than failing the write, it is a registered workflow that does nothing.
 */
function stepsForStorage(steps: WorkflowStep[]): Prisma.InputJsonArray {
  const stored = toInputJsonArray(steps);
  if (!stored) {
    throw new Error("workflow-registry: steps are not storable as JSON; refusing to write a partial definition");
  }
  return stored;
}

/**
 * Fingerprint of a value as it is actually stored — used for the side read back from the database.
 *
 * The stored column is JSON, not `WorkflowStep[]`, and this comparison is structural rather than
 * semantic: it asks "are these byte-equivalent after canonicalisation", which needs no knowledge of
 * the step union at all. Saying so directly removes the `current.steps as unknown as WorkflowStep[]`
 * assertion, which claimed something about database contents that nothing had verified.
 *
 * A malformed stored value now simply fingerprints differently and trips the immutability error
 * below — the same fail-closed outcome, reached without pretending the value was typed.
 */
export function fingerprintStoredSteps(steps: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(steps))).digest("hex").slice(0, 32);
}

/** Stable fingerprint of a version's behaviour, invariant to how the store happened to order keys. */
export function fingerprintSteps(steps: WorkflowStep[]): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(steps))).digest("hex").slice(0, 32);
}

export function registerWorkflow(definition: WorkflowDefinitionInput): void {
  const id = key(definition.workflowId, definition.version);
  const existing = registry.get(id);
  if (existing) {
    // Same id+version already in memory (boot retry, combined-suite re-import). One registration.
    if (fingerprintSteps(existing.steps) === fingerprintSteps(definition.steps)) {
      return;
    }
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

  /**
   * ── Phase 6G: the certification gate ───────────────────────────────────────
   *
   * Applies only to definitions that declare a risk class. Their absence is what marks a workflow
   * as legacy — the engine self-test and everything written before 6G — and those must keep
   * registering exactly as they always have. Forcing them through a certification table would break
   * working software to satisfy a lifecycle they were never part of.
   */
  if (definition.riskClass) {
    /**
     * A workflow cannot outrank its own risk class.
     *
     * The same substring list the shadow guard uses, so "what counts as high risk" has one
     * definition. A LOW workflow that quietly contains a refund step is not a labelling mistake to
     * be corrected later; it is a workflow whose declared blast radius is a fiction.
     */
    if (definition.riskClass !== "HIGH") {
      for (const step of definition.steps) {
        const target = step.type === "ACTION" ? step.actionId : step.type === "ESCALATION" ? step.target : null;
        if (!target) continue;
        const match = HIGH_RISK_ACTIONS.find((h) => target.toLowerCase().includes(h));
        if (match) {
          throw new Error(
            `Workflow ${id} is declared riskClass=${definition.riskClass} but step "${step.id}" targets ` +
              `"${target}", which matches the high-risk action "${match}". Declare riskClass=HIGH or remove the step.`,
          );
        }
      }
    }

    /**
     * The synchronous half of the LIVE gate. The other half — an actual certification row — needs
     * the database and is enforced at sync, activation and instance creation, because a definition
     * can declare anything it likes about itself and only the row is evidence.
     */
    const mode = definition.executionMode ?? "LIVE";
    if (mode === "LIVE" && definition.certificationStatus !== "CERTIFIED") {
      throw new Error(
        `Workflow ${id} declares executionMode LIVE with certificationStatus ` +
          `${definition.certificationStatus ?? "DRAFT"}. A business automation starts in SHADOW and ` +
          `reaches LIVE through certification.`,
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
export type QuarantinedDefinition = {
  workflowId: string;
  version: number;
  declaredExecutionMode: string;
  declaredCertificationStatus: string;
  capabilityFingerprint: string;
  reason: string;
  at: string;
};

/** What the last sync refused, so diagnostics can show it rather than only the log stream. */
let lastQuarantine: QuarantinedDefinition[] = [];

/** Definitions the most recent sync refused to write or activate. */
export function quarantinedDefinitions(): readonly QuarantinedDefinition[] {
  return lastQuarantine;
}

export async function syncWorkflowDefinitions(): Promise<{
  created: number; updated: number; unchanged: number; quarantined: QuarantinedDefinition[];
}> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const quarantined: QuarantinedDefinition[] = [];

  for (const def of registry.values()) {
    /**
     * The half of the LIVE gate that needs the database. Code can claim CERTIFIED; only a row proves it.
     *
     * ── Quarantine, not abort ────────────────────────────────────────────────
     *
     * This used to throw, and the throw travelled all the way out of `bootstrapWorkflows()`. When
     * the nine partner certifications were voided, the very first one aborted the loop and the whole
     * automation registry stopped syncing — one unauthorised definition took the platform's boot
     * with it, and every unrelated workflow after it in the iteration order was left unsynced.
     *
     * Refusing the definition is right; refusing the process is not. A definition that cannot prove
     * its authorisation is quarantined: skipped, recorded with the reason, and never written or
     * activated. Boot continues, and the workflows that can prove themselves still sync.
     *
     * This is a safety state, not a fallback. A quarantined definition is not written to the
     * database, so `resolveActiveVersion` finds nothing and the trigger bridge starts nothing —
     * there is no path from quarantine to execution.
     */
    try {
      await assertLiveAllowed({
        automationId: def.workflowId,
        workflowVersion: def.version,
        riskClass: def.riskClass,
        certificationStatus: def.certificationStatus,
        executionMode: def.executionMode ?? "LIVE",
        // The other half of the scope: a certification approves this version *on this engine*.
        capabilityFingerprint: fingerprintFor(def),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      quarantined.push({
        workflowId: def.workflowId,
        version: def.version,
        declaredExecutionMode: def.executionMode ?? "LIVE",
        declaredCertificationStatus: def.certificationStatus ?? "DRAFT",
        capabilityFingerprint: fingerprintFor(def),
        reason,
        at: new Date().toISOString(),
      });
      logger.error("workflow_definition_quarantined", {
        workflowId: def.workflowId,
        version: def.version,
        declaredExecutionMode: def.executionMode ?? "LIVE",
        declaredCertificationStatus: def.certificationStatus ?? "DRAFT",
        reason,
      });
      continue;
    }

    const existing = await prisma.workflowDefinition.findUnique({
      where: { workflowId_version: { workflowId: def.workflowId, version: def.version } },
    });

    /** Holds the row a lost create race turned up, so the immutability check still sees one. */
    const existingHolder: { current: typeof existing } = { current: existing };

    if (!existing) {
      /**
       * Several nodes boot at once, and all of them run this.
       *
       * Looking the row up and then creating it is a read followed by a write, and a rolling deploy
       * is exactly the situation where four processes do both at the same moment: the first
       * succeeds and the rest collide on the unique index. Left to throw, that is not a tidy
       * warning — `syncWorkflowDefinitions` runs during bootstrap, so every node except the winner
       * fails to start, and the deploy looks like a crash loop with a database error nobody can
       * place.
       *
       * The collision is the index doing its job. Whoever lost simply reads the winner's row and
       * carries on down the same path as any other process that found the definition already there.
       */
      try {
        await prisma.workflowDefinition.create({
          data: {
            workflowId: def.workflowId,
            version: def.version,
            name: def.name,
            trigger: def.trigger,
            steps: stepsForStorage(def.steps),
            maxAgeMs: def.maxAgeMs,
            maxSteps: def.maxSteps,
            executionMode: def.executionMode ?? "LIVE",
            certificationStatus: def.certificationStatus ?? "DRAFT",
            riskClass: def.riskClass ?? null,
            metadata: (def.metadata ?? {}) as object,
          },
        });
        created++;
        continue;
      } catch (err) {
        if ((err as { code?: string }).code !== "P2002") throw err;
        const winner = await prisma.workflowDefinition.findUnique({
          where: { workflowId_version: { workflowId: def.workflowId, version: def.version } },
        });
        if (!winner) throw err;
        // Fall through with the row that actually exists, so the immutability check below still runs.
        Object.assign(existingHolder, { current: winner });
      }
    }

    const current = existingHolder.current ?? existing!;
    if (current.activatedAt) {
      const stored = fingerprintStoredSteps(current.steps);
      const fresh = fingerprintSteps(def.steps);
      if (stored !== fresh) {
        throw new Error(
          `Workflow ${key(def.workflowId, def.version)} was activated on ${current.activatedAt.toISOString()} ` +
            `and its steps have since changed. Activated versions are immutable — publish v${def.version + 1} instead.`,
        );
      }
      /**
       * Steps are immutable once activated. Authorization metadata is not, and must not be.
       *
       * This branch used to `continue` straight past the update, so an activated row kept whatever
       * `executionMode` and `certificationStatus` it was written with — forever. When the nine
       * Section-01 definitions were moved to SHADOW/DRAFT in code, the database went on reporting
       * ACTIVE/LIVE/CERTIFIED, and anything reading it for state would have drawn exactly the wrong
       * conclusion about what was authorised.
       *
       * The immutability rule exists because running instances execute the steps they were started
       * under; it says nothing about who approved the version. Instances pin their own execution
       * mode at creation and the engine reads the code registry, so refreshing these three fields
       * changes no running behaviour — it only stops the row from misrepresenting authorisation.
       */
      const authorizationDrifted =
        current.executionMode !== (def.executionMode ?? "LIVE") ||
        current.certificationStatus !== (def.certificationStatus ?? "DRAFT") ||
        current.riskClass !== (def.riskClass ?? null);

      if (authorizationDrifted) {
        await prisma.workflowDefinition.update({
          where: { id: current.id },
          data: {
            executionMode: def.executionMode ?? "LIVE",
            certificationStatus: def.certificationStatus ?? "DRAFT",
            riskClass: def.riskClass ?? null,
          },
        });
        logger.warn("workflow_authorization_reconciled", {
          workflowId: def.workflowId,
          version: def.version,
          from: `${current.executionMode}/${current.certificationStatus}`,
          to: `${def.executionMode ?? "LIVE"}/${def.certificationStatus ?? "DRAFT"}`,
        });
        updated++;
        continue;
      }

      unchanged++;
      continue;
    }

    await prisma.workflowDefinition.update({
      where: { id: current.id },
      data: {
        name: def.name,
        trigger: def.trigger,
        steps: stepsForStorage(def.steps),
        maxAgeMs: def.maxAgeMs,
        maxSteps: def.maxSteps,
        executionMode: def.executionMode ?? "LIVE",
        certificationStatus: def.certificationStatus ?? "DRAFT",
        riskClass: def.riskClass ?? null,
        metadata: (def.metadata ?? {}) as object,
      },
    });
    updated++;
  }

  lastQuarantine = quarantined;
  logger.info("workflow_definitions_synced", {
    created, updated, unchanged, quarantined: quarantined.length,
  });
  return { created, updated, unchanged, quarantined };
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
