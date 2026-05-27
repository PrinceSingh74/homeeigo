import { useCallback, useState } from "react";

export type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  time: string;
};

const INITIAL: AiChatMessage[] = [
  {
    id: "u1",
    role: "user",
    text: "AC cooling kam kar raha hai",
    time: "09:41 AM",
  },
  {
    id: "a1",
    role: "assistant",
    text: "Possible airflow issue detected. Would you like instant diagnosis?",
    time: "09:41 AM",
  },
];

const AI_REPLIES = [
  "Got it — running quick diagnosis now.",
  "I found 3 nearby verified experts. Want me to book the fastest one?",
  "Let me check that. Meanwhile, try restarting the device once.",
  "Sure! I'll schedule a visit at your earliest available slot.",
  "Based on your home history, here's what I recommend…",
];

function formatTime() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

export function useAiChat() {
  const [messages, setMessages] = useState<AiChatMessage[]>(INITIAL);
  const [isThinking, setIsThinking] = useState(false);

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isThinking) return false;

    setMessages((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        role: "user",
        text: trimmed,
        time: formatTime(),
      },
    ]);
    setIsThinking(true);

    setTimeout(
      () => {
        setIsThinking(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: AI_REPLIES[Math.floor(Math.random() * AI_REPLIES.length)],
            time: formatTime(),
          },
        ]);
      },
      900 + Math.random() * 700,
    );
    return true;
  }, [isThinking]);

  const resetChat = useCallback(() => {
    setMessages(INITIAL);
    setIsThinking(false);
  }, []);

  return { messages, isThinking, sendText, resetChat };
}
