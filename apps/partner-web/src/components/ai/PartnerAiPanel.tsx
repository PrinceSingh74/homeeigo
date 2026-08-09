"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Bot, Send, Sparkles } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import {
  usePartnerDashboardQuery,
  usePartnerMeQuery,
} from "@/hooks/use-partner-data";
import { formatInr } from "@/lib/format";

const suggestions = [
  "Best jobs near me right now?",
  "Predict my earnings this week",
  "How can I improve my acceptance rate?",
];

type ChatMessage = { role: "user" | "ai"; text: string };

export function PartnerAiPanel() {
  const dashboard = usePartnerDashboardQuery();
  const me = usePartnerMeQuery();

  const headline = useMemo(() => {
    if (dashboard.isLoading) return "Analysing your day…";
    const pending = dashboard.data?.counts.pendingRequests ?? 0;
    if (pending > 0) {
      return `${pending} request${pending === 1 ? "" : "s"} waiting — accept fast to keep acceptance rate above 90%.`;
    }
    const today = dashboard.data?.earnings.today ?? 0;
    if (today > 0) {
      return `You've earned ${formatInr(today)} today. Keep momentum through peak hours.`;
    }
    return "Go online to start receiving live job requests.";
  }, [dashboard.data, dashboard.isLoading]);

  const insights = useMemo(() => {
    const items: Array<{ id: string; title: string; body: string }> = [];
    const dash = dashboard.data;
    if (!dash) return items;

    if (dash.counts.pendingRequests > 0) {
      items.push({
        id: "pending",
        title: `${dash.counts.pendingRequests} new request${dash.counts.pendingRequests === 1 ? "" : "s"}`,
        body: "Tap Requests in the sidebar to review and accept.",
      });
    }

    if (dash.rates.acceptanceRate < 0.9) {
      items.push({
        id: "acceptance",
        title: "Lift acceptance above 90%",
        body: "Higher acceptance unlocks weekly bonuses and better matching priority.",
      });
    }

    if ((me.data?.rating ?? 0) >= 4.9) {
      items.push({
        id: "rating",
        title: "Perfect-rating bonus active",
        body: "Each completed job earns +₹50 while your rating stays ≥ 4.9.",
      });
    } else if ((me.data?.rating ?? 0) > 0) {
      items.push({
        id: "rating",
        title: "Aim for 4.9+ rating",
        body: "Perfect-rating bonus unlocks +₹50 per job.",
      });
    }

    if (dash.earnings.thisWeek > 0) {
      items.push({
        id: "week",
        title: `Weekly net: ${formatInr(dash.earnings.thisWeek)}`,
        body: "Commission tier improves once you cross 50/100/200 jobs this month.",
      });
    }

    return items.slice(0, 3);
  }, [dashboard.data, me.data?.rating]);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMessages((m) => [
      ...m,
      { role: "user", text: trimmed },
      {
        role: "ai",
        text: aiReply(trimmed, dashboard.data, me.data?.rating ?? 0),
      },
    ]);
    setInput("");
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {insights.length === 0 ? (
          <PartnerCard glass>
            <Sparkles className="h-4 w-4 text-partner-primary" />
            <p className="mt-2 font-semibold">{headline}</p>
            <p className="mt-1 text-sm text-partner-muted">
              {dashboard.isLoading
                ? "Live insights load with your dashboard."
                : "Insights will appear as you complete jobs and receive ratings."}
            </p>
          </PartnerCard>
        ) : (
          insights.map((insight) => (
            <PartnerCard key={insight.id} glass>
              <Sparkles className="h-4 w-4 text-partner-primary" />
              <p className="mt-2 font-semibold">{insight.title}</p>
              <p className="mt-1 text-sm text-partner-muted">{insight.body}</p>
            </PartnerCard>
          ))
        )}
      </div>

      <PartnerCard className="flex min-h-[360px] flex-col">
        <div className="flex items-center gap-2 border-b border-partner-line pb-3">
          <Bot className="h-5 w-5 text-partner-primary" />
          <span className="font-semibold">HOMEEIGO Pro AI</span>
        </div>
        <div className="partner-scroll flex-1 space-y-3 overflow-y-auto py-4">
          {messages.length === 0 ? (
            <p className="text-sm text-partner-muted">
              Ask about routes, earnings, scheduling, or how to improve your stats.
            </p>
          ) : (
            messages.map((msg, i) => (
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
            ))
          )}
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

      <p className="text-[10px] text-partner-muted-dim">
        Local heuristic replies — the live AI assistant ships once the backend AI
        endpoint is available. Stats above are real, from{" "}
        <code>/api/providers/me/dashboard</code>.
      </p>
    </div>
  );
}

function aiReply(
  question: string,
  dashboard: ReturnType<typeof usePartnerDashboardQuery>["data"],
  rating: number,
): string {
  const q = question.toLowerCase();
  if (!dashboard) return "Give me a moment — your stats are still loading.";
  if (q.includes("earnings") || q.includes("earn")) {
    return `You've netted ${formatInr(dashboard.earnings.today)} today and ${formatInr(dashboard.earnings.thisWeek)} this week. Forecast for the week is on pace if peak-hour acceptance stays above 85%.`;
  }
  if (q.includes("accept")) {
    const acc = Math.round(dashboard.rates.acceptanceRate * 100);
    return `Acceptance rate is ${acc}%. ${acc < 90 ? "Bonus tier unlocks at 90% — try to respond within 5 minutes of a request." : "You're in the bonus tier — keep it up."}`;
  }
  if (q.includes("rating")) {
    return `Average rating: ${rating > 0 ? rating.toFixed(2) : "no ratings yet"}. ${rating >= 4.9 ? "You qualify for the perfect-rating bonus." : "Reach 4.9 for the perfect-rating bonus (+₹50 per job)."}`;
  }
  if (q.includes("route") || q.includes("near")) {
    return "Cluster nearby jobs to minimise travel and lift ₹/hour. Try to chain 2–3 jobs within the same sector.";
  }
  return "I can answer questions about your earnings, acceptance, ratings and route optimisation. Try one of the quick suggestions below.";
}
