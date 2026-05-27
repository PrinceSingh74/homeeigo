"use client";

import { create } from "zustand";
import { AI_DEMO_MESSAGES } from "@/lib/ai-dashboard";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
  quickActions?: string[];
};

type AiState = {
  messages: ChatMessage[];
  draft: string;
  voiceMode: boolean;
  isRecording: boolean;
  setDraft: (v: string) => void;
  toggleVoiceMode: () => void;
  setRecording: (v: boolean) => void;
  clearChat: () => void;
  sendMessage: (text: string) => void;
  resetDemo: () => void;
};

function nowTime() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function demoReply(userText: string): ChatMessage {
  const lower = userText.toLowerCase();
  let content =
    "I can help with that. Would you like me to book a verified expert or run an instant AI diagnosis?";
  if (lower.includes("ac") || lower.includes("cooling")) {
    content =
      "I've analyzed your AC performance and found possible airflow blockage. Would you like me to book an expert for inspection?";
  } else if (lower.includes("leak") || lower.includes("water")) {
    content =
      "Water sensors show normal flow, but I recommend a quick inspection. Upload a photo or book a plumber?";
  } else if (lower.includes("clean")) {
    content =
      "I can schedule deep cleaning with a top-rated crew. Standard slots start at ₹199. Shall I book for you?";
  } else if (lower.includes("pest")) {
    content =
      "Pest activity looks low, but a preventive scan is recommended. I can book pest control this week.";
  } else if (lower.includes("schedule") || lower.includes("book")) {
    content =
      "I found open slots tomorrow morning and evening. Pick a service and I'll confirm instantly.";
  } else if (lower.includes("diagnosis") || lower.includes("upload") || lower.includes("image")) {
    content =
      "Upload a clear photo of the issue — I'll run AI vision diagnosis in under 30 seconds.";
  } else if (lower.includes("optim") || lower.includes("bill") || lower.includes("energy")) {
    content =
      "You can save up to ₹450 this month. I recommend AC filter service and smart thermostat scheduling.";
  } else if (lower.includes("safety") || lower.includes("secure")) {
    content = "All safety systems are active. Smoke, gas, and entry sensors report normal status.";
  }
  return {
    id: `ai-${Date.now()}`,
    role: "assistant",
    content,
    time: nowTime(),
    quickActions: ["Instant AI Diagnosis", "Book Expert", "Upload Photo"],
  };
}

export const useAiStore = create<AiState>((set) => ({
  messages: [...AI_DEMO_MESSAGES],
  draft: "",
  voiceMode: false,
  isRecording: false,

  setDraft: (draft) => set({ draft }),
  toggleVoiceMode: () => set((s) => ({ voiceMode: !s.voiceMode })),
  setRecording: (isRecording) => set({ isRecording }),

  clearChat: () =>
    set({
      messages: [
        {
          id: "ai-welcome",
          role: "assistant",
          content: "Hello Arjun! 👋 How can I help you with your home today?",
          time: nowTime(),
          quickActions: ["Instant AI Diagnosis", "Book Expert", "Upload Photo"],
        },
      ],
    }),

  resetDemo: () => set({ messages: [...AI_DEMO_MESSAGES] }),

  sendMessage: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      time: nowTime(),
    };
    set((s) => ({
      messages: [...s.messages, userMsg],
      draft: "",
    }));
    window.setTimeout(() => {
      set((s) => ({
        messages: [...s.messages, demoReply(trimmed)],
      }));
    }, 600);
  },
}));
