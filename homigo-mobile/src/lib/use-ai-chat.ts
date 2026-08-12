import { useCallback, useEffect, useRef, useState } from "react";
import { coreApi } from "@/services/core/api";
import { useAuthStore } from "@/stores/auth-store";

export type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
  quickActions?: string[];
};

function formatTime() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function welcomeMessage(firstName?: string): AiChatMessage {
  const name = firstName?.trim() || "there";
  return {
    id: "welcome",
    role: "assistant",
    text: `Hello ${name}! How can I help with your home today?`,
    time: formatTime(),
    quickActions: ["Book Expert", "Instant Diagnosis", "Track Booking"],
  };
}

export function useAiChat() {
  const user = useAuthStore((s) => s.user);
  const [messages, setMessages] = useState<AiChatMessage[]>(() => [
    welcomeMessage(user?.firstName ?? undefined),
  ]);
  const [isThinking, setIsThinking] = useState(false);
  const conversationId = useRef<string | undefined>(undefined);

  // Reload the most recent conversation from PostgreSQL on first open.
  useEffect(() => {
    let active = true;
    void coreApi.ai
      .latestConversation()
      .then((conv) => {
        if (!active || !conv || conv.messages.length === 0) return;
        conversationId.current = conv.id;
        setMessages(
          conv.messages.map((m) => ({
            id: m.id,
            role: m.role,
            text: m.content,
            time: new Date(m.createdAt).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            }),
          })),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isThinking) return false;

      const userMsg: AiChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        text: trimmed,
        time: formatTime(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsThinking(true);

      try {
        const history = [...messages, userMsg].slice(-10).map((m) => ({
          role: m.role,
          content: m.text,
        }));
        const data = await coreApi.ai.chat({
          message: trimmed,
          conversationId: conversationId.current,
          history,
        });
        conversationId.current = data.conversationId;
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: data.reply,
            time: formatTime(),
            quickActions: data.quickActions,
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: "I'm having trouble reaching the server. Please try again in a moment.",
            time: formatTime(),
          },
        ]);
      } finally {
        setIsThinking(false);
      }
      return true;
    },
    [isThinking, messages],
  );

  const resetChat = useCallback(() => {
    const id = conversationId.current;
    if (id) void coreApi.ai.deleteConversation(id).catch(() => {});
    conversationId.current = undefined;
    setMessages([welcomeMessage(user?.firstName ?? undefined)]);
    setIsThinking(false);
  }, [user?.firstName]);

  return { messages, isThinking, sendText, resetChat };
}
