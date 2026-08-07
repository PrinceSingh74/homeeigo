import prisma from "../../lib/prisma";
import {
  enrichMessageMetadata,
  compressConversationIfNeeded,
  detectIntentFromText,
} from "../memory/conversation-memory";

export type GatewayTurnResult = {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
};

/** Persist gateway turn into AiConversation/AiMessage with intelligence metadata. */
export async function persistGatewayTurn(
  userId: string,
  conversationId: string | undefined,
  userText: string,
  assistantText: string,
): Promise<GatewayTurnResult> {
  let convId = conversationId;

  if (convId) {
    const owned = await prisma.aiConversation.findFirst({
      where: { id: convId, userId },
      select: { id: true },
    });
    if (!owned) convId = undefined;
  }

  if (!convId) {
    const conv = await prisma.aiConversation.create({
      data: { userId, title: userText.slice(0, 60) },
      select: { id: true },
    });
    convId = conv.id;
  }

  const intent = detectIntentFromText(userText);

  const userMsg = await prisma.aiMessage.create({
    data: {
      conversationId: convId,
      role: "user",
      content: userText,
      intent,
      tokens: Math.ceil(userText.length / 4),
    },
    select: { id: true },
  });

  const assistantMsg = await prisma.aiMessage.create({
    data: {
      conversationId: convId,
      role: "assistant",
      content: assistantText,
      tokens: Math.ceil(assistantText.length / 4),
    },
    select: { id: true },
  });

  await enrichMessageMetadata(convId, userMsg.id, userText, "user");
  await compressConversationIfNeeded(convId);

  await prisma.aiConversation.update({
    where: { id: convId },
    data: { updatedAt: new Date() },
  });

  return {
    conversationId: convId,
    userMessageId: userMsg.id,
    assistantMessageId: assistantMsg.id,
  };
}
