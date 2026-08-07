import type { AiMessage } from "../../ai/types";
import prisma from "../../lib/prisma";
import { storeMemory } from "./memory-engine";

const MAX_HISTORY_TURNS = 20;
const COMPRESSION_THRESHOLD = 30;

export type ConversationMemory = {
  id: string;
  summary: string | null;
  topics: string[];
  pinnedFacts: string[];
  intentHistory: string[];
  sentiment: string | null;
  resolution: string | null;
  messages: AiMessage[];
  tokenBudget: number | null;
};

function extractEntities(text: string): string[] {
  const entities: string[] = [];
  const bookingMatch = text.match(/\b(bkg_[a-z0-9]+|booking\s+#?\d+)\b/gi);
  const serviceMatch = text.match(/\b(AC repair|plumbing|cleaning|electrical|painting|carpentry)\b/gi);
  if (bookingMatch) entities.push(...bookingMatch);
  if (serviceMatch) entities.push(...serviceMatch);
  return [...new Set(entities.map((e) => e.toLowerCase()))];
}

export function detectIntentFromText(text: string): string {
  const lower = text.toLowerCase();
  if (/book|schedule|appointment/.test(lower)) return "booking";
  if (/cancel|refund/.test(lower)) return "cancellation";
  if (/track|where|status|eta/.test(lower)) return "tracking";
  if (/price|cost|how much/.test(lower)) return "pricing";
  if (/help|support|complaint/.test(lower)) return "support";
  if (/wallet|payment|pay/.test(lower)) return "payment";
  return "general";
}

function detectSentiment(text: string): string {
  const lower = text.toLowerCase();
  if (/thank|great|awesome|perfect|love/.test(lower)) return "positive";
  if (/angry|frustrated|terrible|worst|complaint/.test(lower)) return "negative";
  if (/urgent|asap|immediately|emergency/.test(lower)) return "urgent";
  return "neutral";
}

export async function loadConversationMemory(
  userId: string,
  conversationId: string,
): Promise<ConversationMemory | null> {
  const conv = await prisma.aiConversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      messages: { orderBy: { createdAt: "asc" }, take: MAX_HISTORY_TURNS },
    },
  });

  if (!conv) return null;

  return {
    id: conv.id,
    summary: conv.summary,
    topics: (conv.topics as string[] | null) ?? [],
    pinnedFacts: (conv.pinnedFacts as string[] | null) ?? [],
    intentHistory: (conv.intentHistory as string[] | null) ?? [],
    sentiment: conv.sentiment,
    resolution: conv.resolution,
    messages: conv.messages.map((m) => ({ role: m.role as AiMessage["role"], content: m.content })),
    tokenBudget: conv.tokenBudget,
  };
}

export async function enrichMessageMetadata(
  conversationId: string,
  messageId: string,
  content: string,
  role: string,
): Promise<void> {
  if (role !== "user") return;

  const intent = detectIntentFromText(content);
  const entities = extractEntities(content);
  const sentiment = detectSentiment(content);

  await prisma.aiMessage.update({
    where: { id: messageId },
    data: { intent, entities, sentiment, tokens: Math.ceil(content.length / 4) },
  }).catch(() => undefined);

  const conv = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
    select: { intentHistory: true, topics: true, sentiment: true },
  });

  if (conv) {
    const intents = [...((conv.intentHistory as string[] | null) ?? []), intent].slice(-10);
    const topics = [...new Set([...((conv.topics as string[] | null) ?? []), ...entities])].slice(-15);

    await prisma.aiConversation.update({
      where: { id: conversationId },
      data: { intentHistory: intents, topics, sentiment },
    }).catch(() => undefined);
  }
}

export async function summarizeConversation(conversationId: string): Promise<string | null> {
  const conv = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  if (!conv || conv.messages.length === 0) return null;

  const turns = conv.messages.slice(-10);
  const summaryParts = turns.map((m) => `${m.role}: ${m.content.slice(0, 100)}`);
  const summary = summaryParts.join(" | ").slice(0, 500);

  await prisma.aiConversation.update({
    where: { id: conversationId },
    data: { summary, compressedAt: new Date() },
  });

  await storeMemory({
    memoryKey: `conv:${conversationId}`,
    memoryType: "CONVERSATION",
    ownerId: conv.userId,
    content: { conversationId, messageCount: conv.messages.length },
    summary,
    importance: 0.6,
  });

  return summary;
}

export async function pinFact(conversationId: string, fact: string): Promise<void> {
  const conv = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
    select: { pinnedFacts: true, userId: true },
  });
  if (!conv) return;

  const facts = [...((conv.pinnedFacts as string[] | null) ?? []), fact].slice(-20);
  await prisma.aiConversation.update({
    where: { id: conversationId },
    data: { pinnedFacts: facts },
  });

  await storeMemory({
    memoryKey: `pin:${conversationId}:${facts.length}`,
    memoryType: "SEMANTIC",
    ownerId: conv.userId,
    content: { fact, conversationId },
    summary: fact,
    importance: 0.9,
  });
}

export async function compressConversationIfNeeded(conversationId: string): Promise<boolean> {
  const count = await prisma.aiMessage.count({ where: { conversationId } });
  if (count < COMPRESSION_THRESHOLD) return false;
  await summarizeConversation(conversationId);
  return true;
}

export async function setConversationResolution(conversationId: string, resolution: string): Promise<void> {
  await prisma.aiConversation.update({
    where: { id: conversationId },
    data: { resolution },
  });
}

export async function recallConversationContext(
  userId: string,
  query: string,
  limit = 5,
): Promise<Array<{ id: string; title: string | null; summary: string | null; relevance: number }>> {
  const conversations = await prisma.aiConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, summary: true, topics: true, intentHistory: true },
  });

  const q = query.toLowerCase();
  return conversations
    .map((c) => {
      const text = `${c.title ?? ""} ${c.summary ?? ""} ${JSON.stringify(c.topics)} ${JSON.stringify(c.intentHistory)}`.toLowerCase();
      const relevance = text.includes(q) ? 1 : q.split(" ").filter((w) => text.includes(w)).length / q.split(" ").length;
      return { id: c.id, title: c.title, summary: c.summary, relevance };
    })
    .filter((c) => c.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}
