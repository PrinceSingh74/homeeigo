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

function requireAdmin(role: string, set: { status: number }) {
  if (role !== "ADMIN") {
    set.status = 403;
    return { success: false, error: "Admin only", code: "FORBIDDEN" };
  }
  return null;
}

/** Phase 4 Enterprise AI Brain routes — context, memory, prompts, timeline. */
export const aiBrainRoutes = new Elysia({ prefix: "/api/ai" })
  .use(authPlugin)

  // ── Context ──
  .post("/context", async ({ requireAuth, body, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const built = await buildEnterpriseContext({
      actorId: userId,
      actorRole: role as never,
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
      actorRole: role as never,
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
      memoryType: query.type as never,
      query: query.q,
      limit: Number(query.limit ?? 20),
    });
    return { success: true, data: memories };
  })

  .get("/memory/:key", async ({ requireAuth, params, query, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const memory = await retrieveMemory(params.key, query.ownerId ?? userId, (query.type ?? "SEMANTIC") as never);
    if (!memory) {
      set.status = 404;
      return { success: false, error: "Memory not found" };
    }
    return { success: true, data: memory };
  })

  .post("/memory", async ({ requireAuth, body, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const memory = await storeMemory({
      memoryKey: body.memoryKey,
      memoryType: body.memoryType as never,
      ownerId: body.ownerId ?? userId,
      content: body.content as Record<string, unknown>,
      summary: body.summary,
      importance: body.importance,
      ttlSeconds: body.ttlSeconds,
    });
    return { success: true, data: memory };
  }, {
    body: t.Object({
      memoryKey: t.String(),
      memoryType: t.String(),
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
      approvalStatus: query.status as never,
    });
    return { success: true, data: { prompts, categories: REGISTRY_CATEGORIES } };
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
  .post("/conversations/:id/summarize", async ({ requireAuth, params, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const summary = await summarizeConversation(params.id);
    return { success: true, data: { summary } };
  })

  .post("/conversations/:id/pin", async ({ requireAuth, params, body, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    await pinFact(params.id, body.fact);
    return { success: true };
  }, {
    body: t.Object({ fact: t.String() }),
  })

  .get("/conversations/recall", async ({ requireAuth, query, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const results = await recallConversationContext(userId, query.q ?? "", Number(query.limit ?? 5));
    return { success: true, data: results };
  })

  .get("/conversations", async ({ requireAuth, query, set }) => {
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

  .get("/conversations/:id", async ({ requireAuth, params, set }) => {
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
