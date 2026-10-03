import crypto from "node:crypto";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { AuditLogService } from "./audit-log.service";
import type { MlModelStage, Prisma } from "@prisma/client";

/**
 * Phase 12 — the governed model registry.
 *
 * ── The one rule this file exists to enforce ───────────────────────────────────
 *
 * A model version reaches PRODUCTION only by a person deciding it should. Not by training
 * successfully, not by beating a baseline, not by a green test suite, not by looking better in
 * shadow. Those are all *evidence*, and this service records them; none of them is authority.
 *
 * `promote()` therefore refuses any version that is not already APPROVED, and `approve()` requires
 * an actor id and a note. There is deliberately no code path from TRAINED to PRODUCTION.
 *
 * ── Why the stage machine is explicit ──────────────────────────────────────────
 *
 * Every transition is declared in `ALLOWED` below. A registry that accepts any update lets a model
 * appear in production without anyone being able to say how it got there, which is exactly the
 * failure this phase is about. An illegal transition returns a typed refusal naming both states.
 *
 * ── Why the database enforces the production invariant ─────────────────────────
 *
 * "At most one PRODUCTION version per model" is a partial unique index, not an `if`. Two concurrent
 * promotions both pass any application-level check; only the index stops the second one.
 */

export const ML_REGISTRY_RULES_VERSION = "ml.registry.v1";

/**
 * Legal transitions.
 *
 * PRODUCTION → PRODUCTION is absent on purpose: replacing a production model is a promotion of a
 * *different* version, which demotes the incumbent to ROLLED_BACK-eligible history rather than
 * editing it in place.
 */
const ALLOWED: Record<MlModelStage, MlModelStage[]> = {
  TRAINING: ["TRAINED", "REJECTED"],
  TRAINED: ["EVALUATED", "REJECTED"],
  EVALUATED: ["CANDIDATE", "REJECTED"],
  CANDIDATE: ["SHADOW", "APPROVED", "REJECTED"],
  SHADOW: ["APPROVED", "REJECTED", "CANDIDATE"],
  APPROVED: ["PRODUCTION", "REJECTED"],
  PRODUCTION: ["ROLLED_BACK", "RETIRED"],
  ROLLED_BACK: ["CANDIDATE", "RETIRED"],
  REJECTED: ["RETIRED"],
  RETIRED: [],
};

export type RegisterInput = {
  modelName: string;
  datasetVersion: string;
  featureVersion: string;
  codeVersion: string;
  artifactRef: string;
  artifactHash?: string | null;
  metrics?: Prisma.InputJsonValue;
  hyperparameters?: Prisma.InputJsonValue;
  seed?: number | null;
  baselineName?: string | null;
  beatsBaseline?: boolean | null;
  actorId: string;
  /** Where the version enters the lifecycle. Never PRODUCTION, never APPROVED — see `assertEntry`. */
  stage?: Extract<MlModelStage, "TRAINING" | "TRAINED" | "EVALUATED" | "CANDIDATE">;
};

export type RegistryResult<T = unknown> =
  | { ok: true; detail: string; data: T }
  | { ok: false; detail: string; code: string };

/**
 * A version may only be created in a pre-approval stage.
 *
 * Registering straight into APPROVED or PRODUCTION would be exactly the blind promotion the phase
 * forbids, dressed as a creation rather than a transition.
 */
function assertEntry(stage: MlModelStage): string | null {
  if (stage === "APPROVED" || stage === "PRODUCTION") {
    return `A version cannot be created in ${stage}. Register it as CANDIDATE and approve it explicitly.`;
  }
  return null;
}

export const mlRegistryService = {
  /**
   * Register a new version of a model.
   *
   * The version number is assigned here, inside the transaction, from the current maximum. A caller
   * cannot choose it: a caller-chosen version is how two different artifacts end up sharing one
   * number, and then "v2" means whichever row was read last.
   */
  async register(input: RegisterInput): Promise<RegistryResult<{ id: string; version: number }>> {
    const stage = input.stage ?? "CANDIDATE";
    const entryError = assertEntry(stage);
    if (entryError) return { ok: false, code: "ILLEGAL_ENTRY_STAGE", detail: entryError };

    for (const [field, value] of Object.entries({
      datasetVersion: input.datasetVersion,
      featureVersion: input.featureVersion,
      codeVersion: input.codeVersion,
      artifactRef: input.artifactRef,
    })) {
      if (!value || !String(value).trim()) {
        return {
          ok: false, code: "MISSING_PROVENANCE",
          detail: `${field} is required. A version without it cannot be rebuilt, and an unrebuildable model is not a governed model.`,
        };
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const latest = await tx.mlModelVersion.findFirst({
        where: { modelName: input.modelName },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      return tx.mlModelVersion.create({
        data: {
          modelName: input.modelName,
          version: (latest?.version ?? 0) + 1,
          stage,
          datasetVersion: input.datasetVersion,
          featureVersion: input.featureVersion,
          codeVersion: input.codeVersion,
          artifactRef: input.artifactRef,
          artifactHash: input.artifactHash ?? null,
          metrics: input.metrics ?? undefined,
          hyperparameters: input.hyperparameters ?? undefined,
          seed: input.seed ?? null,
          baselineName: input.baselineName ?? null,
          beatsBaseline: input.beatsBaseline ?? null,
          trainedAt: stage === "TRAINED" || stage === "EVALUATED" || stage === "CANDIDATE" ? new Date() : null,
          evaluatedAt: input.metrics ? new Date() : null,
          createdBy: input.actorId,
        },
        select: { id: true, version: true },
      });
    });

    incCounter("ml_model_versions_total", { model: input.modelName, stage });
    void AuditLogService.success("ML_MODEL_REGISTERED", {
      userId: input.actorId,
      details: {
        modelName: input.modelName, version: created.version, stage,
        datasetVersion: input.datasetVersion, featureVersion: input.featureVersion,
        codeVersion: input.codeVersion, artifactRef: input.artifactRef,
        beatsBaseline: input.beatsBaseline ?? null,
      },
    });
    logger.info("ml_model_registered", { modelName: input.modelName, version: created.version, stage });
    return { ok: true, detail: `Registered ${input.modelName} v${created.version} as ${stage}.`, data: created };
  },

  /** Move a version between stages, refusing anything the machine does not allow. */
  async transition(args: {
    id: string; to: MlModelStage; actorId: string; reason?: string;
  }): Promise<RegistryResult<{ from: MlModelStage; to: MlModelStage }>> {
    const current = await prisma.mlModelVersion.findUnique({
      where: { id: args.id },
      select: { id: true, modelName: true, version: true, stage: true },
    });
    if (!current) return { ok: false, code: "NOT_FOUND", detail: "No such model version." };

    if (args.to === "PRODUCTION") {
      return {
        ok: false, code: "USE_PROMOTE",
        detail: "PRODUCTION is reached through promote(), which requires a prior human approval. It is not a generic transition.",
      };
    }
    if (args.to === "APPROVED") {
      return {
        ok: false, code: "USE_APPROVE",
        detail: "APPROVED is reached through approve(), which records who approved and why.",
      };
    }
    if (!ALLOWED[current.stage].includes(args.to)) {
      return {
        ok: false, code: "ILLEGAL_TRANSITION",
        detail: `${current.stage} → ${args.to} is not a legal transition. Allowed from ${current.stage}: ${ALLOWED[current.stage].join(", ") || "none"}.`,
      };
    }

    await prisma.mlModelVersion.update({
      where: { id: args.id },
      data: {
        stage: args.to,
        rejectedReason: args.to === "REJECTED" ? (args.reason ?? "No reason recorded.") : undefined,
        retiredAt: args.to === "RETIRED" ? new Date() : undefined,
      },
    });
    incCounter("ml_model_transitions_total", { model: current.modelName, from: current.stage, to: args.to });
    void AuditLogService.success("ML_MODEL_STAGE_CHANGED", {
      userId: args.actorId,
      reason: args.reason?.slice(0, 200),
      details: { modelName: current.modelName, version: current.version, from: current.stage, to: args.to },
    });
    return { ok: true, detail: `${current.modelName} v${current.version}: ${current.stage} → ${args.to}.`, data: { from: current.stage, to: args.to } };
  },

  /**
   * A person approves a version for production.
   *
   * The note is mandatory and is stored. "Approved" with no stated reason is indistinguishable from
   * a rubber stamp six months later, and the whole point of this record is that someone can be asked
   * why. Approval does **not** promote — that is a second, separate act, so an approval can be given
   * and a promotion deferred or never made.
   */
  async approve(args: { id: string; actorId: string; note: string }): Promise<RegistryResult<{ version: number }>> {
    const note = args.note?.trim() ?? "";
    if (note.length < 10) {
      return {
        ok: false, code: "APPROVAL_NOTE_REQUIRED",
        detail: "An approval note of at least 10 characters is required: an unexplained approval is not an auditable decision.",
      };
    }
    const current = await prisma.mlModelVersion.findUnique({
      where: { id: args.id },
      select: { id: true, modelName: true, version: true, stage: true, metrics: true, beatsBaseline: true },
    });
    if (!current) return { ok: false, code: "NOT_FOUND", detail: "No such model version." };
    if (!ALLOWED[current.stage].includes("APPROVED")) {
      return {
        ok: false, code: "ILLEGAL_TRANSITION",
        detail: `${current.stage} cannot be approved. A version must be CANDIDATE or SHADOW first, so that there is evidence to approve on.`,
      };
    }
    if (current.metrics === null) {
      return {
        ok: false, code: "NO_EVIDENCE",
        detail: "This version has no recorded evaluation metrics. Approving a model nobody measured is the failure this registry exists to prevent.",
      };
    }

    await prisma.mlModelVersion.update({
      where: { id: args.id },
      data: { stage: "APPROVED", approvedBy: args.actorId, approvedAt: new Date(), approvalNote: note },
    });
    incCounter("ml_model_approvals_total", { model: current.modelName });
    /**
     * §46 — awaited and fail-closed, not `void`.
     *
     * `void AuditLogService.success(...)` discarded the promise, so an audit failure on the most
     * consequential act in the model lifecycle vanished without reaching the caller. Now a failure
     * to persist surfaces as an error, so an operator is told "this may have happened and was not
     * recorded — investigate" instead of being told it succeeded cleanly.
     *
     * Its limit, stated rather than glossed: the audit is written outside the transaction that
     * changed the stage, so a throw here does NOT roll the stage change back. Making it atomic
     * means writing the audit row on the same `tx`, which requires threading a transaction client
     * through `enterpriseAuditService` — a change to a shared service with many callers, and one
     * to make deliberately rather than as a side effect of this phase.
     */
    await AuditLogService.recordGoverned("ML_MODEL_APPROVED", "success", {
      userId: args.actorId,
      reason: note.slice(0, 200),
      details: {
        modelName: current.modelName, version: current.version,
        fromStage: current.stage, beatsBaseline: current.beatsBaseline,
      },
    });
    logger.info("ml_model_approved", { modelName: current.modelName, version: current.version, actorId: args.actorId });
    return { ok: true, detail: `${current.modelName} v${current.version} approved. Promotion is a separate act.`, data: { version: current.version } };
  },

  /**
   * Promote an approved version to production.
   *
   * The incumbent is recorded on the incoming row as `supersededVersionId` **before** it is moved
   * aside, so the rollback target is a stored fact rather than something reconstructed from
   * timestamps later. Both writes happen in one transaction: a promotion that half-applied would
   * leave either two production models or none.
   */
  async promote(args: { id: string; actorId: string }): Promise<RegistryResult<{ version: number; superseded: number | null }>> {
    const incoming = await prisma.mlModelVersion.findUnique({
      where: { id: args.id },
      select: { id: true, modelName: true, version: true, stage: true, approvedBy: true },
    });
    if (!incoming) return { ok: false, code: "NOT_FOUND", detail: "No such model version." };
    if (incoming.stage !== "APPROVED") {
      return {
        ok: false, code: "NOT_APPROVED",
        detail: `Only an APPROVED version can be promoted; this one is ${incoming.stage}. There is no path from training or shadow straight to production.`,
      };
    }

    const result = await prisma.$transaction(async (tx) => {
      const incumbent = await tx.mlModelVersion.findFirst({
        where: { modelName: incoming.modelName, stage: "PRODUCTION" },
        select: { id: true, version: true },
      });
      if (incumbent) {
        /**
         * The incumbent leaves PRODUCTION before the new one enters it. With the partial unique
         * index on (model_name) WHERE stage='PRODUCTION', doing it the other way round would fail
         * on the index — which is the index doing its job, and the reason the order is deliberate.
         */
        await tx.mlModelVersion.update({ where: { id: incumbent.id }, data: { stage: "ROLLED_BACK", rolledBackAt: new Date() } });
      }
      await tx.mlModelVersion.update({
        where: { id: args.id },
        data: { stage: "PRODUCTION", promotedAt: new Date(), supersededVersionId: incumbent?.id ?? null },
      });
      return { superseded: incumbent?.version ?? null };
    });

    incCounter("ml_model_promotions_total", { model: incoming.modelName });
    await AuditLogService.recordGoverned("ML_MODEL_PROMOTED", "success", {
      userId: args.actorId,
      details: {
        modelName: incoming.modelName, version: incoming.version,
        supersededVersion: result.superseded, approvedBy: incoming.approvedBy,
      },
    });
    logger.info("ml_model_promoted", { modelName: incoming.modelName, version: incoming.version, superseded: result.superseded });
    return {
      ok: true,
      detail: `${incoming.modelName} v${incoming.version} is now PRODUCTION${result.superseded ? `, replacing v${result.superseded}` : ""}.`,
      data: { version: incoming.version, superseded: result.superseded },
    };
  },

  /**
   * Roll production back to the version it replaced.
   *
   * The target is read from `supersededVersionId` rather than "the previous version number", because
   * the previous number is not always the previous *production* model — versions get rejected and
   * retired, and guessing would silently restore something that never served traffic.
   */
  async rollback(args: { modelName: string; actorId: string; reason: string }): Promise<RegistryResult<{ from: number; to: number | null }>> {
    const reason = args.reason?.trim() ?? "";
    if (reason.length < 10) {
      return { ok: false, code: "ROLLBACK_REASON_REQUIRED", detail: "A rollback reason of at least 10 characters is required." };
    }
    const live = await prisma.mlModelVersion.findFirst({
      where: { modelName: args.modelName, stage: "PRODUCTION" },
      select: { id: true, version: true, supersededVersionId: true },
    });
    if (!live) return { ok: false, code: "NOT_IN_PRODUCTION", detail: `${args.modelName} has no version in production.` };

    const result = await prisma.$transaction(async (tx) => {
      await tx.mlModelVersion.update({
        where: { id: live.id },
        data: { stage: "ROLLED_BACK", rolledBackAt: new Date(), rolledBackBy: args.actorId, rolledBackReason: reason.slice(0, 500) },
      });
      if (!live.supersededVersionId) return { to: null };
      const target = await tx.mlModelVersion.findUnique({
        where: { id: live.supersededVersionId },
        select: { id: true, version: true },
      });
      if (!target) return { to: null };
      await tx.mlModelVersion.update({ where: { id: target.id }, data: { stage: "PRODUCTION", promotedAt: new Date() } });
      return { to: target.version };
    });

    incCounter("ml_model_rollbacks_total", { model: args.modelName });
    await AuditLogService.recordGoverned("ML_MODEL_ROLLED_BACK", "success", {
      userId: args.actorId,
      reason: reason.slice(0, 200),
      details: { modelName: args.modelName, fromVersion: live.version, toVersion: result.to },
    });
    logger.info("ml_model_rolled_back", { modelName: args.modelName, from: live.version, to: result.to });
    return {
      ok: true,
      detail: result.to === null
        ? `${args.modelName} v${live.version} rolled back; no prior production version exists, so the model now has none. Serving falls back to its deterministic path.`
        : `${args.modelName} rolled back from v${live.version} to v${result.to}.`,
      data: { from: live.version, to: result.to },
    };
  },

  /** The version currently serving, or null. The only question the serving path should ask. */
  async production(modelName: string) {
    return prisma.mlModelVersion.findFirst({ where: { modelName, stage: "PRODUCTION" } });
  },

  /** Everything known about one model, newest first. */
  async history(modelName: string) {
    return prisma.mlModelVersion.findMany({ where: { modelName }, orderBy: { version: "desc" }, take: 100 });
  },

  /** Every governed model with its current stages. */
  async list() {
    const rows = await prisma.mlModelVersion.findMany({ orderBy: [{ modelName: "asc" }, { version: "desc" }], take: 500 });
    const byModel = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byModel.get(r.modelName) ?? [];
      arr.push(r);
      byModel.set(r.modelName, arr);
    }
    return [...byModel.entries()].map(([modelName, versions]) => ({
      modelName,
      versions: versions.length,
      production: versions.find((v) => v.stage === "PRODUCTION") ?? null,
      latest: versions[0]!,
      stages: versions.reduce((a, v) => { a[v.stage] = (a[v.stage] ?? 0) + 1; return a; }, {} as Record<string, number>),
    }));
  },
};

/** Deterministic identifier for a rule-based artifact, so a "model" with no file still has a hash. */
export function deterministicArtifactHash(spec: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 32);
}
