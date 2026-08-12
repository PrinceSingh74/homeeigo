"use client";

import { useState } from "react";
import { Bot, Send, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { useAppStore } from "@/stores/app-store";
import { useRouter } from "next/navigation";
import { bookUrl } from "@/lib/booking-url";
import { searchServices } from "@/lib/services";

const QUICK_PROMPTS = [
  "Book home cleaning tomorrow",
  "AC not cooling — need repair",
  "Best package for 2BHK",
  "Apply promo COOL100",
];

export function AiAssistantSheet({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const router = useRouter();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "ai"; text: string }[]
  >([
    {
      role: "ai",
      text: "Hi Arjun! 👋 I can help you book a service, pick a package, or find offers. What do you need today?",
    },
  ]);

  function reply(userText: string) {
    const q = userText.toLowerCase();
    let response =
      "I found matching services for you. Tap below to continue booking.";
    let href = bookUrl();

    if (q.includes("cool100") || q.includes("ac")) {
      href = bookUrl({ service: "ac-service", promo: "COOL100" });
      response =
        "Great choice! AC Service with code COOL100 — ₹100 off. Opening booking…";
    } else if (q.includes("clean")) {
      href = bookUrl({ service: "deep-cleaning" });
      response =
        "Home Cleaning from ₹199. I recommend the Standard package for 2BHK homes.";
    } else if (q.includes("plumb")) {
      href = bookUrl({ service: "plumbing" });
      response = "Plumbing from ₹249 with verified pros in your area.";
    } else if (q.includes("2bhk") || q.includes("package")) {
      href = bookUrl({ service: "deep-cleaning", package: 1 });
      response =
        "For 2BHK, Standard Deep Cleaning (₹299) is our most popular pick.";
    } else {
      const matches = searchServices(userText);
      if (matches[0]) {
        href = bookUrl({ service: matches[0].id });
        response = `I'd suggest ${matches[0].title}. Ready to book?`;
      }
    }

    setMessages((m) => [
      ...m,
      { role: "user", text: userText },
      { role: "ai", text: response },
    ]);

    setTimeout(() => {
      closeOverlay();
      router.push(href);
      showToast("AI picked the best match for you", "success");
    }, 900);
  }

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    reply(text);
  }

  return (
    <Modal open={open} onClose={closeOverlay} title="HOMEEIGO AI" size="md">
      <div className="mb-4 flex items-center gap-2 rounded-2xl bg-aurora/10 px-4 py-3 text-sm text-content">
        <Sparkles size={18} className="text-primary" />
        Powered by AI — instant answers, smart booking
      </div>

      <div className="mb-4 flex max-h-52 flex-col gap-3 overflow-y-auto">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-8 rounded-2xl bg-primary/10 px-4 py-2.5 text-sm text-content"
                : "mr-6 flex gap-2 rounded-2xl glass-card px-4 py-2.5 text-sm text-content"
            }
          >
            {m.role === "ai" && (
              <Bot size={18} className="mt-0.5 shrink-0 text-primary" />
            )}
            {m.text}
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => reply(p)}
            className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-content hover:bg-primary/5"
          >
            {p}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask anything…"
          size="lg"
          showClear={false}
          className="min-w-0 flex-1"
          containerClassName="rounded-2xl bg-surface/60"
          aria-label="Message to HOMEEIGO AI"
        />
        <button
          type="button"
          onClick={handleSend}
          aria-label="Send message"
          className="grid size-12 shrink-0 place-items-center rounded-2xl bg-aurora text-white"
        >
          <Send size={18} />
        </button>
      </div>
    </Modal>
  );
}
