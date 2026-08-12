"use client";

import { useEffect, useRef } from "react";
import { Bot, Trash2 } from "lucide-react";
import { m as motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAiPageActions } from "@/hooks/use-ai-page-actions";
import { useAiStore } from "@/stores/ai-store";
import { AI_SECTION_IDS } from "@/lib/ai-page-actions";
import { aiGlassPanel, aiSectionTitle } from "@/components/ai/ai-page-layout";
import { fadeUp } from "@/components/ai/ai-motion";

export function AiChatSection() {
  const messages = useAiStore((s) => s.messages);
  const isThinking = useAiStore((s) => s.isThinking);
  const clearChat = useAiStore((s) => s.clearChat);
  const loadHistory = useAiStore((s) => s.loadHistory);
  const { runChatQuickAction } = useAiPageActions();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reload the saved conversation from the backend on first open.
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isThinking]);

  return (
    <section id={AI_SECTION_IDS.chat} className="flex min-h-0 scroll-mt-24 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2 sm:mb-3">
        <h2 className={aiSectionTitle}>AI Conversation</h2>
        <button
          type="button"
          onClick={clearChat}
          className="flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-600 transition hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-200 sm:text-[13px]"
        >
          <Trash2 size={14} />
          <span className="hidden min-[380px]:inline">Clear Chat</span>
          <span className="min-[380px]:hidden">Clear</span>
        </button>
      </div>

      <div
        ref={scrollRef}
        className={cn(
          aiGlassPanel,
          "flex min-h-[220px] max-h-[min(52dvh,380px)] flex-col gap-4 overflow-y-auto overscroll-y-contain rounded-2xl p-3.5 [-webkit-overflow-scrolling:touch]",
          "sm:min-h-[300px] sm:max-h-[400px] sm:gap-5 sm:rounded-3xl sm:p-5",
          "lg:min-h-[400px] lg:p-6",
        )}
      >
        {messages.map((msg, i) => (
          <motion.div
            key={msg.id}
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={i}
            className={cn(
              "flex gap-2 sm:gap-3",
              msg.role === "user" ? "flex-row-reverse items-end" : "items-start",
            )}
          >
            {msg.role === "assistant" && (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
                <Bot size={16} />
              </span>
            )}

            <div className={cn("max-w-[90%] sm:max-w-[600px]", msg.role === "user" && "text-right")}>
              {msg.role === "assistant" && (
                <p className="mb-1 text-[11px] font-semibold text-slate">AI Assistant</p>
              )}
              <div
                className={cn(
                  "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-[0_2px_8px_rgb(0_0_0/0.04)]",
                  msg.role === "user"
                    ? "bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-[0_4px_12px_rgb(16_185_129/0.25)]"
                    : "ai-chat-assistant-bubble border border-[#E5E7EB] bg-[#F9FAFB] text-ink",
                )}
              >
                {msg.content}
              </div>
              <p className="mt-1 text-[10px] text-slate" suppressHydrationWarning>
                {msg.time}
              </p>

              {msg.quickActions && msg.role === "assistant" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {msg.quickActions.map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => runChatQuickAction(label)}
                      className="ai-chat-quick-btn rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        ))}

        {isThinking && (
          <div className="flex items-start gap-2 sm:gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
              <Bot size={16} />
            </span>
            <div className="ai-chat-assistant-bubble flex items-center gap-1 rounded-2xl border px-4 py-3">
              <span className="size-1.5 animate-bounce rounded-full bg-slate [animation-delay:-0.3s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-slate [animation-delay:-0.15s]" />
              <span className="size-1.5 animate-bounce rounded-full bg-slate" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
