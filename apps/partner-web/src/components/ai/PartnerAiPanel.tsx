"use client";

import { useMemo, useState } from "react";
import { m as motion } from "framer-motion";
import { Send, Sparkles } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import {
  usePartnerDashboardQuery,
  usePartnerMeQuery,
} from "@/hooks/use-partner-data";
import { partnerApi } from "@/services/partner-api";
import { formatInr } from "@/lib/format";

const suggestions = [
  "How much did I earn this week?",
  "Which jobs are next?",
  "When should I go online?",
  "Which zone has more demand?",
  "How am I performing?",
  "What training should I complete?",
];

type ChatMessage = {
  role: "user" | "ai";
  text: string;
  mode?: "llm" | "offline" | "deterministic_fallback";
  basis?: string[];
  recommendation?: string | null;
};

function parseStructured(text: string, basis?: string[], recommendation?: string | null) {
  return {
    answer: text,
    basis: basis ?? [],
    recommendation: recommendation ?? null,
  };
}

export function PartnerAiPanel() {
  const dashboard = usePartnerDashboardQuery();
  const me = usePartnerMeQuery();

  const headline = useMemo(() => {
    if (dashboard.isLoading) return "Reading your day…";
    const pending = dashboard.data?.counts.pendingRequests ?? 0;
    if (pending > 0) {
      return `${pending} request${pending === 1 ? "" : "s"} waiting.`;
    }
    const today = dashboard.data?.earnings.today ?? 0;
    if (today > 0) {
      return `Verified today: ${formatInr(today)}.`;
    }
    return "Ask a question — answers come from your live tools, not guesses.";
  }, [dashboard.data, dashboard.isLoading]);

  const insights = useMemo(() => {
    const items: Array<{ id: string; title: string; body: string }> = [];
    const dash = dashboard.data;
    if (!dash) return items;
    if (dash.counts.pendingRequests > 0) {
      items.push({
        id: "pending",
        title: `${dash.counts.pendingRequests} waiting request${dash.counts.pendingRequests === 1 ? "" : "s"}`,
        body: "From your live job inbox.",
      });
    }
    if (dash.earnings.thisWeek > 0) {
      items.push({
        id: "week",
        title: `This week ${formatInr(dash.earnings.thisWeek)}`,
        body: "Net earnings from completed jobs.",
      });
    }
    if ((me.data?.rating ?? 0) > 0) {
      items.push({
        id: "rating",
        title: `Rating ${me.data!.rating.toFixed(2)}`,
        body: "Canonical score — the assistant explains it, it does not invent it.",
      });
    }
    return items.slice(0, 3);
  }, [dashboard.data, me.data]);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setPending(true);
    try {
      const res = await partnerApi.aiChat(trimmed, history);
      const mode = res.mode === "deterministic_fallback" ? "deterministic_fallback" : "llm";
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text: res.content,
          mode,
          basis: res.basis,
          recommendation: res.recommendation,
        },
      ]);
      setHistory((h) => {
        const next: Array<{ role: "user" | "assistant"; content: string }> = [
          ...h,
          { role: "user", content: trimmed },
          { role: "assistant", content: res.content },
        ];
        return next.slice(-12);
      });
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text: "Live AI is temporarily unavailable. Open Earnings, Jobs, or Smart Zones for the latest verified figures.",
          mode: "offline",
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        {insights.length === 0 ? (
          <PartnerCard>
            <Sparkles className="h-4 w-4 text-partner-primary" aria-hidden />
            <p className="mt-2 font-semibold">{headline}</p>
            <p className="mt-1 text-sm text-partner-muted">
              {dashboard.isLoading
                ? "Live figures load with your dashboard."
                : "Not enough verified data yet for insight cards."}
            </p>
          </PartnerCard>
        ) : (
          insights.map((insight) => (
            <PartnerCard key={insight.id}>
              <p className="font-semibold">{insight.title}</p>
              <p className="mt-1 text-sm text-partner-muted">{insight.body}</p>
            </PartnerCard>
          ))
        )}
      </div>

      <PartnerCard className="flex min-h-[420px] flex-col">
        <div className="flex items-center justify-between border-b border-partner-line pb-3">
          <div>
            <p className="font-semibold">Partner Copilot</p>
            <p className="text-xs text-partner-muted">Answer · basis · recommendation. Read-only.</p>
          </div>
        </div>
        <div className="partner-scroll flex-1 space-y-3 overflow-y-auto py-4" role="log" aria-live="polite">
          {messages.length === 0 ? (
            <p className="text-sm text-partner-muted">
              Ask about earnings, next jobs, demand, performance, or training. If data is missing, the
              assistant will say so.
            </p>
          ) : (
            messages.map((msg, i) => {
              if (msg.role === "user") {
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-partner-primary/20 px-3 py-2 text-sm"
                  >
                    {msg.text}
                  </motion.div>
                );
              }
              const structured = parseStructured(msg.text, msg.basis, msg.recommendation);
              return (
                <motion.article
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="max-w-[92%] space-y-2 rounded-2xl border border-partner-line bg-partner-bg/60 px-3 py-3 text-sm"
                >
                  <p className="font-medium text-partner-text">{structured.answer}</p>
                  {structured.basis.length > 0 ? (
                    <ul className="space-y-0.5 text-xs text-partner-muted">
                      {structured.basis.map((b) => (
                        <li key={b}>Based on: {b}</li>
                      ))}
                    </ul>
                  ) : null}
                  {structured.recommendation ? (
                    <p className="text-xs text-partner-muted">{structured.recommendation}</p>
                  ) : null}
                  {msg.mode === "offline" || msg.mode === "deterministic_fallback" ? (
                    <p className="text-[10px] uppercase tracking-wide text-partner-warning">
                      {msg.mode === "offline"
                        ? "Offline — verified tools unavailable"
                        : "Verified summary — live model unavailable"}
                    </p>
                  ) : null}
                </motion.article>
              );
            })
          )}
          {pending ? (
            <p className="text-sm text-partner-muted" aria-live="polite">
              Reading verified partner data…
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-partner-line pt-3">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="min-h-11 rounded-full border border-partner-line px-3 py-2 text-xs text-partner-muted transition hover:border-partner-primary/40 hover:text-partner-text"
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
          <label htmlFor="partner-copilot-input" className="sr-only">
            Ask the partner copilot
          </label>
          <input
            id="partner-copilot-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={pending}
            placeholder="Ask about earnings, schedule, demand…"
            className="min-h-11 flex-1 rounded-xl border border-partner-line bg-partner-bg/60 px-3 py-2.5 text-sm outline-none focus:border-partner-primary disabled:opacity-60"
          />
          <PartnerButton type="submit" variant="primary" disabled={pending} aria-label="Send">
            <Send className="h-4 w-4" />
          </PartnerButton>
        </form>
      </PartnerCard>

      <p className="text-[10px] text-partner-muted-dim">
        Answers are grounded in approved read tools. The copilot cannot pay, refund, or change job
        state.
      </p>
    </div>
  );
}
