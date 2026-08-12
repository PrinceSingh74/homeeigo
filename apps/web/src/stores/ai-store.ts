"use client";

import { create } from "zustand";
import { coreApi } from "@/services/core/api";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  time: string;
  quickActions?: string[];
};

type AiState = {
  messages: ChatMessage[];
  conversationId?: string;
  historyLoaded: boolean;
  draft: string;
  voiceMode: boolean;
  isRecording: boolean;
  isThinking: boolean;
  setDraft: (v: string) => void;
  toggleVoiceMode: () => void;
  setRecording: (v: boolean) => void;
  clearChat: () => void;
  sendMessage: (text: string) => void;
  loadHistory: () => void;
  resetDemo: () => void;
};

function nowTime() {
  return new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

const QUICK_ACTIONS = ["Book Expert", "Browse Services", "Track Booking"];

function welcome(): ChatMessage {
  return {
    id: "ai-welcome",
    role: "assistant",
    content:
      "Hi! I can help with bookings, diagnostics, your wallet and service recommendations. What do you need today?",
    time: nowTime(),
    quickActions: QUICK_ACTIONS,
  };
}

export const useAiStore = create<AiState>((set, get) => ({
  messages: [welcome()],
  conversationId: undefined,
  historyLoaded: false,
  draft: "",
  voiceMode: false,
  isRecording: false,
  isThinking: false,

  setDraft: (draft) => set({ draft }),
  toggleVoiceMode: () => set((s) => ({ voiceMode: !s.voiceMode })),
  setRecording: (isRecording) => set({ isRecording }),

  // Reload the most recent conversation from PostgreSQL on first open.
  loadHistory: () => {
    if (get().historyLoaded) return;
    set({ historyLoaded: true });
    void coreApi.ai
      .latestConversation()
      .then((conv) => {
        if (!conv || conv.messages.length === 0) return;
        set({
          conversationId: conv.id,
          messages: conv.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            time: new Date(m.createdAt).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
            }),
          })),
        });
      })
      .catch(() => {
        /* keep the welcome message on failure */
      });
  },

  clearChat: () => {
    const id = get().conversationId;
    if (id) void coreApi.ai.deleteConversation(id).catch(() => {});
    set({ messages: [welcome()], conversationId: undefined, isThinking: false });
  },
  resetDemo: () => set({ messages: [welcome()], conversationId: undefined, isThinking: false }),

  // Every reply comes from the backend (/api/ai/chat) — no client-side AI logic.
  sendMessage: (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().isThinking) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      time: nowTime(),
    };

    // History is the prior conversation (excludes the message we're about to send).
    const history = get()
      .messages.slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));

    set((s) => ({ messages: [...s.messages, userMsg], draft: "", isThinking: true }));

    void coreApi.ai
      .chat({ message: trimmed, conversationId: get().conversationId, history })
      .then((data) => {
        set((s) => ({
          conversationId: data.conversationId,
          messages: [
            ...s.messages,
            {
              id: `ai-${Date.now()}`,
              role: "assistant",
              content: data.reply,
              time: nowTime(),
              quickActions: data.quickActions,
            },
          ],
          isThinking: false,
        }));
      })
      .catch(() => {
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: `ai-${Date.now()}`,
              role: "assistant",
              content: "Sorry, I couldn't reach the assistant just now. Please try again.",
              time: nowTime(),
              quickActions: QUICK_ACTIONS,
            },
          ],
          isThinking: false,
        }));
      });
  },
}));
