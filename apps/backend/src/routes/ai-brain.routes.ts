import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import {
  buildEnterpriseContext,
  rebuildContext,
  storeMemory,
  retrieveMemories,
  retrieveMemory,
  updateMemory,
  archiveMemory,
  compressMemory,
  getMemoryStatistics,
  listPromptRegistry,
  getPromptById,
  createPromptRegistry,
  createPromptVersion,
  approvePromptVersion,
  rejectPromptVersion,
  deprecatePromptVersion,
  rollbackPromptVersion,
  listPromptVersions,
  getPromptVersionDiff,
  getActivityTimeline,
  getTimelineStatistics,
  getPromptAnalytics,
  getContextHistory,
  searchContextSnapshots,
  purgeExpiredContextCache,
  listContextCache,
  summarizeConversation,
  pinFact,
  recallConversationContext,
  loadConversationMemory,
  REGISTRY_CATEGORIES,
} from "../ai-brain";
import prisma from "../lib/prisma";
import type { AiGatewayRole, AiMemoryType, AiPromptApprovalStatus } from "@prisma/client";
import { mapUserRoleToAiRole } from "../ai/security/authorization";
import { toInputJsonObject } from "../lib/json-input";

function requireAdmin(role: string, set: { status?: number | string }) {
  if (role !== "ADMIN") {
    set.status = 403;
    return { success: false, error: "Admin only", code: "FORBIDDEN" };
  }
  return null;
}

/**
 * Resolves the acting user's `AiGatewayRole`.
 *
 * `role as never` was hiding a genuine enum gap: `UserRole` has VENDOR where `AiGatewayRole` has
 * PARTNER, so the cast could force a value that is not a member of the target enum at all. It is
 * latent today only because every route here is behind `requireAdmin`, and ADMIN happens to exist
 * in both enums — the moment that gate changed, an invalid role would flow into the AI context
 * builder. `mapUserRoleToAiRole` is the security module's own mapping and returns null rather than
 * guessing, so an unmappable role becomes a 403 instead of an invalid enum value.
 */
function adminAiRole(role: string, set: { status?: number | string }): AiGatewayRole {
  const mapped = mapUserRoleToAiRole(role, "admin");
  if (!mapped) {
    // Unreachable while requireAdmin precedes every call, and deliberately not defaulted.
    set.status = 403;
    throw new Error("FORBIDDEN_ROLE");
  }
  return mapped;
}

/** Phase 4 Enterprise AI Brain routes — context, memory, prompts, timeline. */
/**
 * The real `AiMemoryType` enum members.
 *
 * The route previously accepted any `t.String()` and forced it through with `as never`. That value
 * is not inert: it selects the retention TTL (`resolveTtl`) and is fed to the content-safety
 * screen, and stored memory is replayed into later requests. An unknown type silently fell back to
 * the SESSION TTL and only failed once Prisma rejected the enum at write time.
 *
 * `as const satisfies` ties this list to the generated enum, so adding a member without updating
 * the route is a compile error rather than a request that 400s in production.
 */
const MEMORY_TYPES = [
  "SESSION",
  "CONVERSATION",
  "BUSINESS",
  "USER",
  "PARTNER",
  "ADMIN",
  "OPERATIONAL",
  "SEMANTIC",
  "WORKING",
  "HISTORICAL",
] as const satisfies readonly AiMemoryType[];

const MEMORY_TYPE_SCHEMA = t.Union(MEMORY_TYPES.map((m) => t.Literal(m)));

const APPROVAL_STATUSES = [
  "DRAFT",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "DEPRECATED",
] as const satisfies readonly AiPromptApprovalStatus[];

const APPROVAL_STATUS_SCHEMA = t.Union(APPROVAL_STATUSES.map((a) => t.Literal(a)));

export const aiBrainRoutes = new Elysia({ prefix: "/api/ai" })
  .use(authPlugin)

  // ── Context ──
  .post("/context", async ({ requireAuth, body, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const built = await buildEnterpriseContext({
      actorId: userId,
      actorRole: adminAiRole(role, set),
      message: body.message,
      intent: body.intent,
      context: body.context,
      conversationId: body.conversationId,
      language: body.language,
      timezone: body.timezone,
    });

    return { success: true, data: built };
  }, {
    body: t.Object({
      message: t.String(),
      intent: t.Optional(t.String()),
      conversationId: t.Optional(t.String()),
      language: t.Optional(t.String()),
      timezone: t.Optional(t.String()),
      context: t.Optional(t.Record(t.String(), t.Unknown())),
    }),
  })

  .post("/context/rebuild", async ({ requireAuth, body, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const built = await rebuildContext({
      actorId: userId,
      actorRole: adminAiRole(role, set),
      message: body.message,
      context: body.context,
      conversationId: body.conversationId,
    });

    return { success: true, data: built };
  }, {
    body: t.Object({
      message: t.String(),
      conversationId: t.Optional(t.String()),
      context: t.Optional(t.Record(t.String(), t.Unknown())),
    }),
  })

  .get("/context/history", async ({ requireAuth, query, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const history = await getContextHistory(query.actorId ?? userId, Number(query.limit ?? 20));
    return { success: true, data: history };
  })

  .get("/context/search", async ({ requireAuth, query, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const results = await searchContextSnapshots({
      actorId: query.actorId ?? userId,
      contextHash: query.hash,
      since: query.since ? new Date(query.since) : undefined,
      limit: Number(query.limit ?? 50),
    });
    return { success: true, data: results };
  })

  .post("/context/cache/purge", async ({ requireAuth, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const purged = await purgeExpiredContextCache();
    return { success: true, data: { purged } };
  })

  .get("/context/cache", async ({ requireAuth, query, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const entries = await listContextCache({
      actorId: query.actorId ?? userId,
      limit: Number(query.limit ?? 50),
    });
    return { success: true, data: entries };
  })

  // ── Memory ──
  .get("/memory", async ({ requireAuth, query, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const memories = await retrieveMemories({
      ownerId: query.ownerId ?? userId,
      memoryType: query.type,
      query: query.q,
      limit: Number(query.limit ?? 20),
    });
    return { success: true, data: memories };
  }, {
    query: t.Object({
      ownerId: t.Optional(t.String()),
      type: t.Optional(MEMORY_TYPE_SCHEMA),
      q: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })

  .get("/memory/:key", async ({ requireAuth, params, query, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const memory = await retrieveMemory(params.key, query.ownerId ?? userId, query.type ?? "SEMANTIC");
    if (!memory) {
      set.status = 404;
      return { success: false, error: "Memory not found" };
    }
    return { success: true, data: memory };
  }, {
    query: t.Object({
      ownerId: t.Optional(t.String()),
      type: t.Optional(MEMORY_TYPE_SCHEMA),
    }),
  })

  .post("/memory", async ({ requireAuth, body, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    // Validated, not asserted: the previous `as Record<string, unknown>` did not match
    // `MemoryStoreInput.content` (`Prisma.InputJsonObject`), and a value the database cannot
    // store would have failed at the write as a 500 instead of here as a 400.
    const content = toInputJsonObject(body.content);
    if (!content) {
      set.status = 400;
      return { success: false, error: "content must be a JSON object the database can store" };
    }

    const memory = await storeMemory({
      memoryKey: body.memoryKey,
      memoryType: body.memoryType,
      ownerId: body.ownerId ?? userId,
      content,
      summary: body.summary,
      importance: body.importance,
      ttlSeconds: body.ttlSeconds,
    });
    return { success: true, data: memory };
  }, {
    body: t.Object({
      memoryKey: t.String(),
      memoryType: MEMORY_TYPE_SCHEMA,
      ownerId: t.Optional(t.String()),
      content: t.Record(t.String(), t.Unknown()),
      summary: t.Optional(t.String()),
      importance: t.Optional(t.Number()),
      ttlSeconds: t.Optional(t.Number()),
    }),
  })

  .patch("/memory/:id", async ({ requireAuth, params, body, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const updated = await updateMemory(params.id, body);
    if (!updated) {
      set.status = 404;
      return { success: false, error: "Memory not found" };
    }
    return { success: true, data: updated };
  }, {
    body: t.Object({
      content: t.Optional(t.Record(t.String(), t.Unknown())),
      summary: t.Optional(t.String()),
      importance: t.Optional(t.Number()),
    }),
  })

  .delete("/memory/:id", async ({ requireAuth, params, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const archived = await archiveMemory(params.id);
    return { success: archived, data: { archived } };
  })

  .get("/memory/stats", async ({ requireAuth, query, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const stats = await getMemoryStatistics(query.ownerId ?? userId);
    return { success: true, data: stats };
  })

  .post("/memory/:id/compress", async ({ requireAuth, params, body, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const compressed = await compressMemory(params.id, body.summary);
    if (!compressed) {
      set.status = 404;
      return { success: false, error: "Memory not found" };
    }
    return { success: true, data: compressed };
  }, {
    body: t.Object({ summary: t.String() }),
  })

  // ── Prompt Registry ──
  .get("/prompts", async ({ requireAuth, query, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const prompts = await listPromptRegistry({
      category: query.category,
      approvalStatus: query.status,
    });
    return { success: true, data: { prompts, categories: REGISTRY_CATEGORIES } };
  }, {
    query: t.Object({
      category: t.Optional(t.String()),
      status: t.Optional(APPROVAL_STATUS_SCHEMA),
    }),
  })

  .get("/prompts/:promptId", async ({ requireAuth, params, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const prompt = await getPromptById(params.promptId);
    if (!prompt) {
      set.status = 404;
      return { success: false, error: "Prompt not found" };
    }
    return { success: true, data: prompt };
  })

  .post("/prompts", async ({ requireAuth, body, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const prompt = await createPromptRegistry({ ...body, createdBy: userId });
    return { success: true, data: prompt };
  }, {
    body: t.Object({
      promptId: t.String(),
      name: t.String(),
      category: t.String(),
      owner: t.String(),
      description: t.Optional(t.String()),
      systemPrompt: t.String(),
      userTemplate: t.Optional(t.String()),
      maxTokens: t.Optional(t.Number()),
    }),
  })

  // ── Prompt Versions ──
  .get("/prompt-versions/:promptId", async ({ requireAuth, params, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const versions = await listPromptVersions(params.promptId);
    return { success: true, data: versions };
  })

  .post("/prompt-versions", async ({ requireAuth, body, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const result = await createPromptVersion({ ...body, createdBy: userId });
    return { success: true, data: result };
  }, {
    body: t.Object({
      promptId: t.String(),
      systemPrompt: t.String(),
      userTemplate: t.Optional(t.String()),
      temperature: t.Optional(t.Number()),
      maxTokens: t.Optional(t.Number()),
      experimentTag: t.Optional(t.String()),
    }),
  })

  .post("/prompt-versions/approve", async ({ requireAuth, body, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    await approvePromptVersion(body.promptId, body.version, userId);
    return { success: true };
  }, {
    body: t.Object({ promptId: t.String(), version: t.Number() }),
  })

  .post("/prompt-versions/rollback", async ({ requireAuth, body, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    await rollbackPromptVersion(body.promptId, body.version, userId);
    return { success: true };
  }, {
    body: t.Object({ promptId: t.String(), version: t.Number() }),
  })

  .post("/prompt-versions/reject", async ({ requireAuth, body, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    await rejectPromptVersion(body.promptId, userId);
    return { success: true };
  }, {
    body: t.Object({ promptId: t.String() }),
  })

  .post("/prompt-versions/deprecate", async ({ requireAuth, body, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    await deprecatePromptVersion(body.promptId, body.version);
    return { success: true };
  }, {
    body: t.Object({ promptId: t.String(), version: t.Number() }),
  })

  .get("/prompt-versions/:promptId/diff/:version", async ({ requireAuth, params, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const diff = await getPromptVersionDiff(params.promptId, Number(params.version));
    if (!diff) {
      set.status = 404;
      return { success: false, error: "Version not found" };
    }
    return { success: true, data: diff };
  })

  // ── Timeline ──
  .get("/timeline", async ({ requireAuth, query, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const days = Number(query.days ?? 7);
    const since = new Date(Date.now() - days * 86_400_000);

    const [entries, stats, analytics] = await Promise.all([
      getActivityTimeline({
        actorId: query.actorId,
        since,
        limit: Number(query.limit ?? 50),
      }),
      getTimelineStatistics(since),
      getPromptAnalytics(since),
    ]);

    return { success: true, data: { entries, stats, analytics, periodDays: days, requestedBy: userId } };
  })

  // ── Conversation Memory ──
  .post("/brain/conversations/:id/summarize", async ({ requireAuth, params, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const summary = await summarizeConversation(params.id);
    return { success: true, data: { summary } };
  })

  .post("/brain/conversations/:id/pin", async ({ requireAuth, params, body, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    await pinFact(params.id, body.fact);
    return { success: true };
  }, {
    body: t.Object({ fact: t.String() }),
  })

  .get("/brain/conversations/recall", async ({ requireAuth, query, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const results = await recallConversationContext(userId, query.q ?? "", Number(query.limit ?? 5));
    return { success: true, data: results };
  })

  .get("/brain/conversations", async ({ requireAuth, query, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const ownerId = query.userId ?? userId;
    const conversations = await prisma.aiConversation.findMany({
      where: { userId: ownerId },
      orderBy: { updatedAt: "desc" },
      take: Number(query.limit ?? 20),
      include: {
        messages: { orderBy: { createdAt: "desc" }, take: 3 },
        _count: { select: { messages: true } },
      },
    });

    return {
      success: true,
      data: conversations.map((c) => ({
        id: c.id,
        title: c.title,
        summary: c.summary,
        topics: c.topics,
        intentHistory: c.intentHistory,
        sentiment: c.sentiment,
        messageCount: c._count.messages,
        recentMessages: c.messages,
        updatedAt: c.updatedAt,
      })),
    };
  })

  .get("/brain/conversations/:id", async ({ requireAuth, params, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const conv = await loadConversationMemory(userId, params.id);
    if (!conv) {
      set.status = 404;
      return { success: false, error: "Conversation not found" };
    }
    return { success: true, data: conv };
  });
