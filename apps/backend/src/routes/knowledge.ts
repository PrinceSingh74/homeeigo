import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { knowledgeAnswerService } from "../services/knowledge-answer.service";
import { knowledgeRetrievalService, audiencesFor } from "../services/knowledge-retrieval.service";
import { AuditLogService } from "../services/audit-log.service";
import { incCounter } from "../lib/metrics";
import type { KnowledgeActor } from "../services/knowledge.types";
import type { UserRole } from "@prisma/client";

/**
 * Phase 11 — the knowledge endpoint every non-admin surface asks through.
 *
 * ── One engine, one route ──────────────────────────────────────────────────────
 *
 * The partner app and the customer app do not get a retrieval path each. They call this, and the
 * role that decides what may be retrieved is derived server-side from the authenticated principal —
 * never read from the request. A client cannot ask as a partner by saying so, which is the whole
 * reason the role is not a parameter.
 *
 * `/admin/knowledge/*` remains separate because it does different things: authoring, approval,
 * authority and diagnostics. Both call the same retrieval and answer services, so there is one RAG
 * engine with two permission surfaces rather than two engines.
 *
 * ── What a denial looks like ───────────────────────────────────────────────────
 *
 * A customer asking a Partner SOP question is not told that a Partner SOP exists. The document is
 * excluded inside the SQL predicate, so the honest response is "no approved source covers this for
 * you" — the same shape as a genuinely unanswerable question. Returning a distinguishable "you are
 * not allowed to see the document that answers this" would leak the document's existence, which is
 * the thing the audience model is protecting.
 */

/**
 * Map the platform's user role onto a knowledge role.
 *
 * `SUPPORT` is deliberately absent. This platform has no SUPPORT `UserRole` — support staff are
 * ADMIN users distinguished by permission, and inventing a mapping to the knowledge layer's support
 * audience would grant internal knowledge on the strength of a role that does not exist here.
 */
function knowledgeRoleFor(role: UserRole): KnowledgeActor["role"] {
  switch (role) {
    case "ADMIN": return "admin";
    case "VENDOR": return "partner";
    case "CUSTOMER": return "customer";
  }
}

export const knowledgeRoutes = new Elysia({ prefix: "/api/knowledge" })
  .use(authPlugin)

  /**
   * Ask the knowledge base as yourself.
   *
   * Authentication is required: `anonymous` exists in the retrieval model as the least-privileged
   * audience, but exposing an unauthenticated question endpoint would hand the model an open prompt
   * surface, and no product requirement in this phase asks for one.
   */
  .post("/ask", async ({ body, requireAuth }) => {
    const user = requireAuth();
    const role = knowledgeRoleFor(user.role);
    const answer = await knowledgeAnswerService.answer({
      actor: { actorId: user.userId, role },
      question: body.question,
      topK: body.topK,
    });

    /**
     * A question that retrieved nothing at all from a non-admin role is recorded.
     *
     * Not because the caller did something wrong — most are simply unanswerable — but because a
     * customer repeatedly probing for partner or internal material looks exactly like this, and the
     * pattern is only visible if the individual events exist. The question text is not stored: it
     * would put arbitrary user input, potentially personal, into the security audit.
     */
    if (answer.retrieval.chunks.length === 0 && role !== "admin") {
      incCounter("knowledge_empty_retrieval_total", { role });
      void AuditLogService.success("KNOWLEDGE_RETRIEVAL_DENIED", {
        userId: user.userId,
        details: {
          role,
          audiences: audiencesFor(role),
          questionLength: body.question.length,
          reason: answer.refusalReason ?? null,
        },
      });
    }

    return { success: true, data: answer };
  }, {
    body: t.Object({
      question: t.String({ minLength: 3, maxLength: 2000 }),
      topK: t.Optional(t.Number({ minimum: 1, maximum: 20 })),
    }),
  })

  /**
   * What this caller could be answered from, without generating anything.
   *
   * Exists so a client can show "no source covers this" without spending a model call, and so the
   * audience boundary is directly observable in a test rather than only inferable from an answer.
   */
  .post("/retrieve", async ({ body, requireAuth }) => {
    const user = requireAuth();
    const result = await knowledgeRetrievalService.retrieve({
      actor: { actorId: user.userId, role: knowledgeRoleFor(user.role) },
      question: body.question,
      topK: body.topK,
    });
    return { success: true, data: result };
  }, {
    body: t.Object({
      question: t.String({ minLength: 3, maxLength: 2000 }),
      topK: t.Optional(t.Number({ minimum: 1, maximum: 20 })),
    }),
  })

  /**
   * The audiences this caller may read. Used by clients to decide whether to offer the feature at
   * all; it names audience classes, never documents, so it discloses nothing about what exists.
   */
  .get("/scope", async ({ requireAuth }) => {
    const user = requireAuth();
    const role = knowledgeRoleFor(user.role);
    return { success: true, data: { role, audiences: audiencesFor(role) } };
  });
