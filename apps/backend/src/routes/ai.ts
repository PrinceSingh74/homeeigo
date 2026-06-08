import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { parseBody } from "../lib/route-security";
import { aiChatSchema } from "../schemas/ai.schema";
import { customerAiService } from "../services/customer-ai.service";
import { aiConversationService } from "../services/ai-conversation.service";
import prisma from "../lib/prisma";

export const aiRoutes = new Elysia({ prefix: "/api/ai" })
  .use(authPlugin)
  .post(
    "/chat",
    async ({ requireAuth, body: raw }) => {
      const { userId } = requireAuth();
      const body = parseBody(aiChatSchema, raw);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true },
      });
      const reply = customerAiService.chat({
        message: body.message,
        history: body.history,
        firstName: user?.firstName,
      });

      // Resolve the rule's category slug to a REAL catalog service so the
      // recommendation is DB-driven and deep-links to a bookable service.
      let suggestedService:
        | { id: string; name: string; basePrice: number }
        | undefined;
      if (reply.suggestedServiceId) {
        const slug = reply.suggestedServiceId;
        const svc = await prisma.service.findFirst({
          where: {
            isActive: true,
            OR: [
              { category: slug },
              { slug: { contains: slug } },
              { name: { contains: slug.split("-")[0] ?? slug, mode: "insensitive" } },
            ],
          },
          select: { id: true, name: true, basePrice: true },
          orderBy: { popularity: "desc" },
        });
        if (svc) suggestedService = svc;
      }

      // Persist the turn to PostgreSQL (source of truth for chat history).
      const conversationId = await aiConversationService.appendTurn(
        userId,
        body.conversationId,
        body.message,
        reply.message,
      );

      return {
        success: true,
        data: {
          conversationId,
          reply: reply.message,
          quickActions: reply.quickActions,
          // Real service id when resolved, else the original category slug.
          suggestedServiceId: suggestedService?.id ?? reply.suggestedServiceId,
          suggestedService,
        },
      };
    },
    {
      body: t.Object({
        message: t.String(),
        conversationId: t.Optional(t.String()),
        history: t.Optional(
          t.Array(
            t.Object({
              role: t.Union([t.Literal("user"), t.Literal("assistant")]),
              content: t.String(),
            }),
          ),
        ),
      }),
    },
  )
  // ── Conversation history (PostgreSQL-backed) ──────────────────────────────
  .get("/conversations", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await aiConversationService.list(userId);
    return { success: true, data: { conversations: data } };
  })
  .get("/conversations/latest", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await aiConversationService.latest(userId);
    return { success: true, data };
  })
  .get("/conversations/:id", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();
    const data = await aiConversationService.messages(userId, params.id);
    if (!data) {
      set.status = 404;
      return { success: false, error: "Conversation not found", code: "NOT_FOUND" };
    }
    return { success: true, data };
  })
  .delete("/conversations/:id", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();
    const ok = await aiConversationService.remove(userId, params.id);
    if (!ok) {
      set.status = 404;
      return { success: false, error: "Conversation not found", code: "NOT_FOUND" };
    }
    return { success: true, message: "Conversation deleted" };
  });
