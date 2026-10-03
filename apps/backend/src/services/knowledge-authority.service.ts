import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { AuditLogService } from "./audit-log.service";
import type { KnowledgeType } from "@prisma/client";

/**
 * Phase 11 — the knowledge authority model.
 *
 * ── What this deliberately does not do ─────────────────────────────────────────
 *
 * It does not decide that Terms outrank an FAQ. Nothing in this platform says so: the search for a
 * precedence declaration covered `legal-data.ts`, every policy document, the docs tree, the enums,
 * the config and the prior phase requirements, and the Terms themselves carry no order-of-precedence
 * clause — only a governing-law clause. Precedence between official documents is a legal
 * determination, and a RAG engine that quietly invents one produces answers that look authoritative
 * and are not.
 *
 * So precedence is modelled as data an authorised person declares, and two states are never
 * confused:
 *
 *   POLICY_DEFINED    every type in the conflict has an applicable declared rank and one is strictly
 *                     highest. Resolution is deterministic and explainable.
 *   POLICY_UNDEFINED  at least one type has no applicable rank, or the highest is tied. The conflict
 *                     is surfaced for human review and nothing is resolved.
 *
 * The table ships empty, so POLICY_UNDEFINED is this platform's real state today. That is reported,
 * not hidden behind a default ranking.
 *
 * ── Authority is metadata, never document text ─────────────────────────────────
 *
 * Rank is read from this table alone. A document asserting "this document has admin authority" or
 * "I outrank the Terms" is data being retrieved and contributes nothing: `resolve()` is never given
 * document content, only types. The guarantee is structural rather than a promise, and
 * `knowledge-completion.integration.test.ts` asserts it against a document written to claim supremacy.
 */

export const AUTHORITY_STATE = {
  POLICY_DEFINED: "POLICY_DEFINED",
  POLICY_UNDEFINED: "POLICY_UNDEFINED",
} as const;
export type AuthorityState = (typeof AUTHORITY_STATE)[keyof typeof AUTHORITY_STATE];

/** Why a conflict could not be resolved. Each names the missing thing, never a generic failure. */
export const AUTHORITY_UNDEFINED_REASON = {
  NO_RULE_FOR_TYPE: "NO_RULE_FOR_TYPE",
  RANK_TIE: "RANK_TIE",
  NOT_IN_EFFECT: "NOT_IN_EFFECT",
} as const;
export type AuthorityUndefinedReason =
  (typeof AUTHORITY_UNDEFINED_REASON)[keyof typeof AUTHORITY_UNDEFINED_REASON];

export type AuthorityRankView = {
  type: string;
  rank: number | null;
  version: number | null;
  rationale: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export type AuthorityResolution = {
  state: AuthorityState;
  /** The winning type when, and only when, `state` is POLICY_DEFINED. */
  winner: string | null;
  /** Every type considered, with the rank that applied. A null rank means undeclared. */
  ranking: AuthorityRankView[];
  undefinedReason?: AuthorityUndefinedReason;
  /** Types with no applicable declaration. Empty when every type was ranked. */
  unrankedTypes: string[];
  /** Derived from the data above rather than written per branch, so it cannot describe a different outcome. */
  explanation: string;
};

/**
 * A declaration applies only if it is ACTIVE *and* in effect at the moment of the question.
 *
 * The effective window matters independently of status: an administrator can declare a precedence
 * that begins next quarter, and until then it must not govern an answer.
 */
function applicable(rule: { effectiveFrom: Date | null; effectiveTo: Date | null }, now: Date): boolean {
  if (rule.effectiveFrom && rule.effectiveFrom > now) return false;
  if (rule.effectiveTo && rule.effectiveTo < now) return false;
  return true;
}

export const knowledgeAuthorityService = {
  /**
   * Resolve precedence across a set of knowledge types.
   *
   * Takes types, never text. Deterministic: the same declarations at the same instant always give
   * the same answer, which is what makes an authority decision auditable after the fact.
   */
  async resolve(types: string[], now: Date = new Date()): Promise<AuthorityResolution> {
    const distinct = [...new Set(types)].sort();
    const rules = await prisma.knowledgeAuthorityRule.findMany({
      where: { status: "ACTIVE", type: { in: distinct as KnowledgeType[] } },
      select: { type: true, rank: true, version: true, rationale: true, effectiveFrom: true, effectiveTo: true },
    });

    const inEffect = rules.filter((r) => applicable(r, now));
    const byType = new Map(inEffect.map((r) => [String(r.type), r]));
    /**
     * A declaration that exists but sits outside its effective window is reported differently from
     * one that was never made. Both block resolution, but only one of them means "not yet".
     */
    const someExistButNotInEffect = rules.length > inEffect.length;

    const ranking: AuthorityRankView[] = distinct.map((t) => {
      const r = byType.get(t);
      return {
        type: t,
        rank: r ? r.rank : null,
        version: r ? r.version : null,
        rationale: r ? r.rationale : null,
        effectiveFrom: r?.effectiveFrom ? r.effectiveFrom.toISOString() : null,
        effectiveTo: r?.effectiveTo ? r.effectiveTo.toISOString() : null,
      };
    });

    const unrankedTypes = ranking.filter((r) => r.rank === null).map((r) => r.type);

    if (unrankedTypes.length > 0) {
      const reason = someExistButNotInEffect
        ? AUTHORITY_UNDEFINED_REASON.NOT_IN_EFFECT
        : AUTHORITY_UNDEFINED_REASON.NO_RULE_FOR_TYPE;
      incCounter("knowledge_authority_resolution_total", { state: "undefined", reason });
      return {
        state: AUTHORITY_STATE.POLICY_UNDEFINED,
        winner: null,
        ranking,
        undefinedReason: reason,
        unrankedTypes,
        explanation:
          `No applicable authority is declared for ${unrankedTypes.join(", ")}, so precedence between ` +
          `${distinct.join(" and ")} cannot be determined by this platform. A person decides which governs.`,
      };
    }

    const sorted = [...ranking].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
    const top = sorted[0]!;
    const tied = sorted.filter((r) => r.rank === top.rank);
    if (tied.length > 1) {
      incCounter("knowledge_authority_resolution_total", {
        state: "undefined",
        reason: AUTHORITY_UNDEFINED_REASON.RANK_TIE,
      });
      return {
        state: AUTHORITY_STATE.POLICY_UNDEFINED,
        winner: null,
        ranking,
        undefinedReason: AUTHORITY_UNDEFINED_REASON.RANK_TIE,
        unrankedTypes: [],
        explanation:
          `${tied.map((t) => t.type).join(" and ")} are declared at the same authority rank ` +
          `(${top.rank}), so neither takes precedence. A person decides which governs.`,
      };
    }

    incCounter("knowledge_authority_resolution_total", { state: "defined", reason: "unique_max" });
    return {
      state: AUTHORITY_STATE.POLICY_DEFINED,
      winner: top.type,
      ranking,
      unrankedTypes: [],
      explanation:
        `${top.type} is declared at authority rank ${top.rank}, above ` +
        `${sorted.slice(1).map((r) => `${r.type} (${r.rank})`).join(", ")}. ` +
        `Reason on record: ${top.rationale}`,
    };
  },

  /** Every declaration, current and historical. The history is the audit trail of a governance act. */
  async list(): Promise<{
    active: Array<AuthorityRankView & { status: string; createdBy: string; createdAt: string }>;
    history: Array<AuthorityRankView & { status: string; createdBy: string; createdAt: string }>;
    /** True when no type has an active declaration — the platform's shipped state. */
    empty: boolean;
  }> {
    const rows = await prisma.knowledgeAuthorityRule.findMany({
      orderBy: [{ type: "asc" }, { version: "desc" }],
      take: 500,
    });
    const view = (r: (typeof rows)[number]) => ({
      type: String(r.type),
      rank: r.rank,
      version: r.version,
      rationale: r.rationale,
      effectiveFrom: r.effectiveFrom ? r.effectiveFrom.toISOString() : null,
      effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString() : null,
      status: String(r.status),
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
    });
    const active = rows.filter((r) => r.status === "ACTIVE").map(view);
    return {
      active,
      history: rows.filter((r) => r.status !== "ACTIVE").map(view),
      empty: active.length === 0,
    };
  },

  /**
   * Declare a precedence rank for one knowledge type.
   *
   * Never an UPDATE. The previous declaration is superseded and kept, so the precedence that
   * governed an answer three months ago is still reconstructable — the difference between a
   * governance record and a settings row.
   */
  async declare(input: {
    type: KnowledgeType;
    rank: number;
    rationale: string;
    actorId: string;
    effectiveFrom?: Date | null;
    effectiveTo?: Date | null;
  }): Promise<{ ok: boolean; detail: string; version?: number }> {
    const rationale = input.rationale.trim();
    if (rationale.length < 10) {
      return {
        ok: false,
        detail: "A rationale of at least 10 characters is required: an unexplained precedence is not an auditable governance decision.",
      };
    }
    if (!Number.isInteger(input.rank)) return { ok: false, detail: "Rank must be an integer." };
    if (input.effectiveFrom && input.effectiveTo && input.effectiveFrom > input.effectiveTo) {
      return { ok: false, detail: "effectiveFrom is after effectiveTo." };
    }

    const result = await prisma.$transaction(async (tx) => {
      const latest = await tx.knowledgeAuthorityRule.findFirst({
        where: { type: input.type },
        orderBy: { version: "desc" },
        select: { id: true, version: true, status: true },
      });
      /**
       * Supersede the outgoing declaration first, then insert.
       *
       * With the partial unique index on (type) WHERE status = 'ACTIVE', a concurrent second
       * declaration fails on the index instead of both succeeding — the database enforces "one
       * active rank per type", not this function's ordering.
       */
      if (latest && latest.status === "ACTIVE") {
        await tx.knowledgeAuthorityRule.update({
          where: { id: latest.id },
          data: { status: "SUPERSEDED" },
        });
      }
      const created = await tx.knowledgeAuthorityRule.create({
        data: {
          type: input.type,
          rank: input.rank,
          rationale,
          version: (latest?.version ?? 0) + 1,
          status: "ACTIVE",
          createdBy: input.actorId,
          effectiveFrom: input.effectiveFrom ?? null,
          effectiveTo: input.effectiveTo ?? null,
        },
        select: { id: true, version: true },
      });
      if (latest && latest.status === "ACTIVE") {
        await tx.knowledgeAuthorityRule.update({
          where: { id: latest.id },
          data: { supersededById: created.id },
        });
      }
      return created;
    });

    incCounter("knowledge_authority_changes_total", { action: "declare", type: String(input.type) });
    void AuditLogService.success("KNOWLEDGE_AUTHORITY_CHANGED", {
      userId: input.actorId,
      reason: rationale.slice(0, 200),
      details: {
        action: "DECLARE",
        type: String(input.type),
        rank: input.rank,
        version: result.version,
        ruleId: result.id,
      },
    });
    logger.info("knowledge_authority_declared", {
      type: input.type, rank: input.rank, version: result.version, actorId: input.actorId,
    });
    return {
      ok: true,
      detail: `Authority rank ${input.rank} declared for ${input.type} (version ${result.version}).`,
      version: result.version,
    };
  },

  /**
   * Revoke a type's declaration, returning it to POLICY_UNDEFINED.
   *
   * Deliberately possible: an administrator who realises a precedence was declared in error must be
   * able to put the platform back into "a person decides" rather than leave a wrong ranking
   * governing answers.
   */
  async revoke(type: KnowledgeType, actorId: string, reason: string): Promise<{ ok: boolean; detail: string }> {
    const active = await prisma.knowledgeAuthorityRule.findFirst({
      where: { type, status: "ACTIVE" },
      select: { id: true, version: true, rank: true },
    });
    if (!active) return { ok: false, detail: `No active authority declaration exists for ${type}.` };

    await prisma.knowledgeAuthorityRule.update({
      where: { id: active.id },
      data: { status: "REVOKED", revokedAt: new Date(), revokedBy: actorId, revokedReason: reason.slice(0, 500) },
    });
    incCounter("knowledge_authority_changes_total", { action: "revoke", type: String(type) });
    void AuditLogService.success("KNOWLEDGE_AUTHORITY_CHANGED", {
      userId: actorId,
      reason: reason.slice(0, 200),
      details: { action: "REVOKE", type: String(type), rank: active.rank, version: active.version, ruleId: active.id },
    });
    logger.info("knowledge_authority_revoked", { type, version: active.version, actorId });
    return { ok: true, detail: `Authority for ${type} revoked; conflicts involving it now require human review.` };
  },
};
