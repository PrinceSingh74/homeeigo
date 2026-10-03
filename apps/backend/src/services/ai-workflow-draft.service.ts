/**
 * Phase 15 — AI-assisted workflow creation.
 *
 * ── The architectural fact that shapes everything here ───────────────────────────
 *
 * Workflows in this platform are **defined in code**. `workflow_definitions` stores a frozen
 * snapshot of an activated code definition, and the registry's boot-time fingerprint check refuses
 * to start if an activated version's steps have changed. There is therefore no route by which a
 * language model can create something the engine will execute, and this service does not try to
 * build one.
 *
 * That is not a workaround. It is the property that makes this capability safe to ship at all: the
 * AI drafts, a person reviews, and a developer commits. Three parties, and the model is the one
 * with the least authority.
 *
 * ── What validation actually checks ──────────────────────────────────────────────
 *
 * Every allowlist is read from the **running registries**, never hardcoded here. A hardcoded list
 * drifts: someone adds a condition, the list does not know, and either a valid draft is rejected
 * or — far worse — a stale entry lets through a step id the engine no longer has. `listConditions()`
 * and the notification template registry are the same sources the executor itself consults, so a
 * draft that passes validation names steps the engine can genuinely run.
 *
 * ── ACTION steps are refused outright ────────────────────────────────────────────
 *
 * `WorkflowStep` includes an `ACTION` variant carrying an `actionId`. Not one of the platform's 25
 * code-defined workflows uses it, and the step executor has no route into the Phase-5 tool layer —
 * so an ACTION step today does nothing. The danger is tomorrow: if that route is ever opened, every
 * AI-drafted ACTION step sitting in the drafts table becomes a way for a model to invoke a tool
 * nobody reviewed. Refusing the step type now costs nothing and closes that door before it exists.
 */
import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { AuditLogService } from "./audit-log.service";
import { listConditions } from "../automation/conditions/condition-registry";
import { triggeredEventTypes } from "../automation/registry/trigger-registry";
import { evaluateFlag } from "./feature-flag.service";

export type DraftStep = Record<string, unknown>;

export type ValidationFinding = {
  code: string;
  severity: "ERROR" | "WARNING" | "INFO";
  stepId?: string;
  detail: string;
};

export type ValidationResult = {
  valid: boolean;
  riskClass: "INERT" | "NOTIFYING" | "ESCALATING" | "REJECTED_UNSAFE";
  findings: ValidationFinding[];
  /** What the allowlists contained at validation time, so a later re-read can be compared. */
  allowlistSnapshot: { conditions: number; triggers: number; notificationTypes: number };
};

/**
 * Step types the engine can execute.
 *
 * ACTION is deliberately absent — see the header. STOP, WAIT, CONDITION, NOTIFICATION and
 * ESCALATION are the five the 25 existing workflows are built from.
 */
const ALLOWED_STEP_TYPES = new Set(["WAIT", "CONDITION", "NOTIFICATION", "ESCALATION", "STOP"]);

/** Bounds that stop a drafted workflow from becoming a resource problem. */
const MAX_STEPS = 40;
const MAX_WAIT_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — beyond any existing definition's maxAge
const MAX_INTENT_CHARS = 2000;

/**
 * Notification types the platform can actually send.
 *
 * Read from the template registry rather than listed here: a draft naming a template that does not
 * exist would pass a hardcoded check and then fail at send time, inside a workflow a person had
 * already approved.
 */
async function allowedNotificationTypes(): Promise<Set<string>> {
  // ACTIVE only. A DRAFT template exists but cannot render, so accepting one would let a reviewer
  // approve a workflow whose notification step fails the first time it fires.
  const rows = await prisma.notificationTemplate
    .findMany({
      where: { status: "ACTIVE" },
      select: { notificationType: true },
      distinct: ["notificationType"],
    })
    .catch(() => [] as Array<{ notificationType: string }>);
  return new Set(rows.map((r) => r.notificationType));
}

/**
 * RELEASE GATE. Same reasoning as the simulation flag: without a key of its own this capability
 * could only be all-on or unreachable. `evaluateFlag` fails closed, so drafting stays OFF until an
 * operator creates and enables the flag, and can be revoked without a deploy.
 *
 * The gate sits on creation, not on `validate` or `review`: validation is read-only, and a draft
 * already created must remain reviewable even if the capability is switched off mid-flight -- an
 * operator turning drafting off should stop new drafts, not strand the ones awaiting a decision.
 */
export const WORKFLOW_DRAFT_FEATURE_FLAG = "PHASE15_AI_WORKFLOW_DRAFTING" as const;

export class AiWorkflowDraftService {
  /**
   * Validate a proposed step array.
   *
   * Runs on every draft before storage and again before approval — a draft validated against
   * yesterday's registry must not be approvable today if a condition has since been removed.
   */
  async validate(input: { steps: DraftStep[]; trigger: string }): Promise<ValidationResult> {
    const findings: ValidationFinding[] = [];
    const conditions = new Set(listConditions());
    const triggers = new Set(triggeredEventTypes());
    const notificationTypes = await allowedNotificationTypes();

    const push = (code: string, severity: ValidationFinding["severity"], detail: string, stepId?: string) =>
      findings.push({ code, severity, detail, stepId });

    if (!Array.isArray(input.steps) || input.steps.length === 0) {
      push("STEPS_EMPTY", "ERROR", "A workflow with no steps cannot be reviewed or executed.");
    }
    if (input.steps.length > MAX_STEPS) {
      push("STEPS_TOO_MANY", "ERROR", `${input.steps.length} steps exceeds the ${MAX_STEPS}-step ceiling.`);
    }
    if (!triggers.has(input.trigger)) {
      push(
        "TRIGGER_UNKNOWN",
        "ERROR",
        `Trigger "${input.trigger}" is not registered. A workflow keyed to an event the platform never emits would sit inert forever and look healthy doing it.`,
      );
    }

    const seenIds = new Set<string>();
    let notifies = false;
    let escalates = false;

    for (const [index, step] of (input.steps ?? []).entries()) {
      const id = typeof step.id === "string" ? step.id : `#${index}`;
      const type = typeof step.type === "string" ? step.type : "";

      if (seenIds.has(id)) push("STEP_ID_DUPLICATE", "ERROR", `Step id "${id}" appears more than once.`, id);
      seenIds.add(id);

      if (!ALLOWED_STEP_TYPES.has(type)) {
        // The ACTION case gets its own message because refusing it is a deliberate policy, not a typo.
        if (type === "ACTION") {
          push(
            "STEP_TYPE_ACTION_REFUSED",
            "ERROR",
            "ACTION steps are not accepted from a generated draft. The engine has no route into the tool layer today, and if one is ever opened this step would become a way for a model to invoke a tool nobody reviewed.",
            id,
          );
        } else {
          push("STEP_TYPE_UNKNOWN", "ERROR", `Step type "${type}" is not one the engine executes.`, id);
        }
        continue;
      }

      if (type === "WAIT") {
        const delay = Number(step.delayMs);
        if (!Number.isFinite(delay) || delay <= 0) {
          push("WAIT_INVALID", "ERROR", "A WAIT step needs a positive delayMs.", id);
        } else if (delay > MAX_WAIT_MS) {
          push("WAIT_TOO_LONG", "ERROR", `A ${Math.round(delay / 86_400_000)}-day wait exceeds the 30-day ceiling.`, id);
        }
      }

      if (type === "CONDITION") {
        const cid = String(step.conditionId ?? "");
        if (!conditions.has(cid)) {
          push(
            "CONDITION_UNKNOWN",
            "ERROR",
            `Condition "${cid}" is not registered. Unregistered conditions fail closed at runtime, so this workflow would stop at this step every time.`,
            id,
          );
        }
      }

      if (type === "NOTIFICATION") {
        notifies = true;
        const ntype = String(step.notificationType ?? "");
        if (notificationTypes.size === 0) {
          push(
            "NOTIFICATION_REGISTRY_EMPTY",
            "WARNING",
            "No notification templates are registered in this environment, so the notification type could not be checked.",
            id,
          );
        } else if (!notificationTypes.has(ntype)) {
          push("NOTIFICATION_TYPE_UNKNOWN", "ERROR", `Notification type "${ntype}" has no registered template.`, id);
        }
        const recipient = String(step.recipient ?? "");
        if (recipient !== "SUBJECT_CUSTOMER" && recipient !== "SUBJECT_PARTNER") {
          push(
            "RECIPIENT_INVALID",
            "ERROR",
            `Recipient "${recipient}" is not one of SUBJECT_CUSTOMER or SUBJECT_PARTNER. A drafted workflow cannot address an arbitrary person.`,
            id,
          );
        }
        // A drafted step must never carry a rendered message or a contact detail.
        for (const forbidden of ["to", "email", "phone", "body", "message", "template", "html"]) {
          if (forbidden in step) {
            push(
              "NOTIFICATION_CARRIES_CONTENT",
              "ERROR",
              `Step carries "${forbidden}". Notification steps name a template type and a recipient role; the platform supplies the channel, language and contact detail.`,
              id,
            );
          }
        }
      }

      if (type === "ESCALATION") escalates = true;
    }

    const hasError = findings.some((f) => f.severity === "ERROR");
    const riskClass: ValidationResult["riskClass"] = hasError
      ? "REJECTED_UNSAFE"
      : escalates
        ? "ESCALATING"
        : notifies
          ? "NOTIFYING"
          : "INERT";

    return {
      valid: !hasError,
      riskClass,
      findings,
      allowlistSnapshot: {
        conditions: conditions.size,
        triggers: triggers.size,
        notificationTypes: notificationTypes.size,
      },
    };
  }

  /**
   * Record a proposed workflow.
   *
   * An invalid draft is stored too, marked `REJECTED_UNSAFE`. Discarding it would throw away the
   * most useful evidence there is: what a model tried to produce when asked. A draft that attempted
   * an ACTION step is exactly the record a later reviewer wants.
   */
  async createDraft(input: {
    proposedId: string;
    name: string;
    intent: string;
    trigger: string;
    steps: DraftStep[];
    actorId: string;
    modelProvider?: string;
    modelName?: string;
    promptVersion?: number;
  }) {
    const flag = await evaluateFlag(WORKFLOW_DRAFT_FEATURE_FLAG);
    if (!flag.enabled) {
      throw new Error(`WORKFLOW_DRAFTING_DISABLED:${flag.reason}`);
    }

    const intent = input.intent.slice(0, MAX_INTENT_CHARS);
    const validation = await this.validate({ steps: input.steps, trigger: input.trigger });

    const draft = await prisma.aiWorkflowDraft.create({
      data: {
        proposedId: input.proposedId,
        name: input.name,
        intent,
        trigger: input.trigger,
        steps: input.steps as unknown as Prisma.InputJsonValue,
        status: "DRAFT",
        riskClass: validation.riskClass,
        validation: validation as unknown as Prisma.InputJsonValue,
        modelProvider: input.modelProvider,
        modelName: input.modelName,
        promptVersion: input.promptVersion,
        promptHash: crypto.createHash("sha256").update(intent).digest("hex").slice(0, 32),
        createdBy: input.actorId,
      },
    });

    incCounter("homigo_ai_workflow_drafts_total", { risk: validation.riskClass, valid: String(validation.valid) });
    logger.info("ai_workflow_draft_created", {
      category: "APPLICATION",
      draftId: draft.id,
      riskClass: validation.riskClass,
      valid: validation.valid,
      errors: validation.findings.filter((f) => f.severity === "ERROR").length,
    });

    return { draft, validation };
  }

  /**
   * A person accepts or rejects the proposal.
   *
   * Approval does **not** make the workflow executable — it authorises a developer to write the
   * code definition. The returned `nextStep` says so explicitly, because "APPROVED" on a screen
   * invites the assumption that something is now running.
   *
   * Re-validated at approval time against the live registries: a draft that passed last week must
   * not be approvable today if a condition it names has since been removed.
   */
  async review(input: {
    draftId: string;
    decision: "APPROVE" | "REJECT";
    actorId: string;
    note: string;
  }): Promise<{ ok: boolean; code: string; detail: string; nextStep?: string }> {
    const note = input.note.trim();
    if (note.length < 10) {
      return {
        ok: false,
        code: "NOTE_REQUIRED",
        detail: "A review note of at least 10 characters is required. An unexplained approval of machine-generated automation is not a review.",
      };
    }

    const draft = await prisma.aiWorkflowDraft.findUnique({ where: { id: input.draftId } });
    if (!draft) return { ok: false, code: "NOT_FOUND", detail: "No such draft." };
    if (draft.status !== "DRAFT") {
      return { ok: false, code: "ALREADY_REVIEWED", detail: `Draft is already ${draft.status}; a decision is made once.` };
    }

    if (input.decision === "APPROVE") {
      const revalidation = await this.validate({
        steps: draft.steps as unknown as DraftStep[],
        trigger: draft.trigger,
      });
      if (!revalidation.valid) {
        return {
          ok: false,
          code: "REVALIDATION_FAILED",
          detail: `The draft no longer validates against the current registries: ${revalidation.findings
            .filter((f) => f.severity === "ERROR")
            .map((f) => f.code)
            .join(", ")}. It cannot be approved in this form.`,
        };
      }
    }

    // Optimistic: only a draft still in DRAFT is moved, so two reviewers cannot both decide.
    const updated = await prisma.aiWorkflowDraft.updateMany({
      where: { id: input.draftId, status: "DRAFT" },
      data: {
        status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        reviewedBy: input.actorId,
        reviewedAt: new Date(),
        reviewNote: note,
      },
    });
    if (updated.count === 0) {
      return { ok: false, code: "LOST_RACE", detail: "Another reviewer decided this draft first." };
    }

    /**
     * Audit, and undo the decision if it cannot be recorded.
     *
     * The status update above has to come first — it is what resolves the race between two
     * reviewers — but that leaves a window where the decision is committed and unattributable. A
     * chaos test caught exactly that: with the audit table unavailable the draft was left APPROVED
     * with nobody's name on it. Approving machine-generated automation unattributed is worse than
     * not approving it, because the decision is real either way and only the accountability is
     * missing.
     *
     * `recordGoverned` throws when the audit cannot be persisted, so the draft is returned to DRAFT
     * and the error rethrown. The reviewer is told it failed and the draft is reviewable again.
     */
    try {
      await AuditLogService.recordGoverned(
        input.decision === "APPROVE" ? "AI_WORKFLOW_DRAFT_APPROVED" : "AI_WORKFLOW_DRAFT_REJECTED",
        "success",
        {
          userId: input.actorId,
          reason: note,
          details: {
            draftId: draft.id,
            proposedId: draft.proposedId,
            riskClass: draft.riskClass,
            modelProvider: draft.modelProvider,
            modelName: draft.modelName,
            promptHash: draft.promptHash,
          },
        },
      );
    } catch (err) {
      await prisma.aiWorkflowDraft
        .updateMany({
          where: { id: input.draftId },
          data: { status: "DRAFT", reviewedBy: null, reviewedAt: null, reviewNote: null },
        })
        .catch(() => {
          // The compensation itself failed. The draft IS now decided-but-unaudited, and that has to
          // be shouted about rather than swallowed.
          logger.error("ai_workflow_draft_review_unaudited", {
            category: "APPLICATION",
            draftId: input.draftId,
            decision: input.decision,
            actorId: input.actorId,
          });
        });
      throw err;
    }

    incCounter("homigo_ai_workflow_draft_reviews_total", { decision: input.decision, risk: draft.riskClass });

    return {
      ok: true,
      code: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      detail:
        input.decision === "APPROVE"
          ? "Draft approved for implementation."
          : "Draft rejected and retained as evidence.",
      nextStep:
        input.decision === "APPROVE"
          ? "NOT YET RUNNING. Workflows are defined in code: a developer must commit the corresponding definition and deploy it before anything executes. Approval authorises that work; it does not perform it."
          : undefined,
    };
  }

  list(status?: "DRAFT" | "REJECTED" | "APPROVED" | "IMPLEMENTED", limit = 50) {
    return prisma.aiWorkflowDraft.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });
  }
}

export const aiWorkflowDraftService = new AiWorkflowDraftService();
