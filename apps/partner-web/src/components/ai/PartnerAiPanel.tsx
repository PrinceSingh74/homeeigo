"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Bot, Send, Sparkles } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { DEMO_AI_INSIGHTS_LIST } from "@/lib/partner-data";

const suggestions = [
  "Best jobs near me right now?",
  "Predict my earnings this week",
  "Optimize my route for today",
];

export function PartnerAiPanel() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "ai"; text: string }[]
  >([
    {
      role: "ai",
      text: "AI recommends accepting nearby AC jobs for 18% higher earnings. 3 requests within 3 km.",
    },
  ]);

  function send(text: string) {
    if (!text.trim()) return;
    setMessages((m) => [
      ...m,
      { role: "user", text },
      {
        role: "ai",
        text: "Based on your zone: peak demand 4–7 PM. Prioritize Sector 45 AC jobs — highest payout density today.",
      },
    ]);
    setInput("");
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {DEMO_AI_INSIGHTS_LIST.map((insight) => (
          <PartnerCard key={insight.id} glass>
            <Sparkles className="h-4 w-4 text-partner-primary" />
            <p className="mt-2 font-semibold">{insight.title}</p>
            <p className="mt-1 text-sm text-partner-muted">{insight.body}</p>
          </PartnerCard>
        ))}
      </div>

      <PartnerCard className="flex min-h-[360px] flex-col">
        <div className="flex items-center gap-2 border-b border-partner-line pb-3">
          <Bot className="h-5 w-5 text-partner-primary" />
          <span className="font-semibold">HOMIGO Pro AI</span>
        </div>
        <div className="partner-scroll flex-1 space-y-3 overflow-y-auto py-4">
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={
                msg.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-partner-primary/25 px-3 py-2 text-sm"
                  : "max-w-[90%] rounded-2xl rounded-bl-md bg-partner-bg/80 px-3 py-2 text-sm text-partner-muted"
              }
            >
              {msg.text}
            </motion.div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-partner-line pt-3">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-partner-line px-3 py-1 text-xs text-partner-muted transition hover:border-partner-primary/40 hover:text-partner-text"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about routes, earnings, scheduling…"
            className="flex-1 rounded-xl border border-partner-line bg-partner-bg/60 px-3 py-2.5 text-sm outline-none focus:border-partner-primary"
          />
          <PartnerButton type="submit" variant="primary">
            <Send className="h-4 w-4" />
          </PartnerButton>
        </form>
      </PartnerCard>
    </div>
  );
}
