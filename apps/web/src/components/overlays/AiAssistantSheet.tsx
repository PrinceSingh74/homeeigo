"use client";

import { useState } from "react";
import { Bot, Send, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { useAppStore } from "@/stores/app-store";
import { useRouter } from "next/navigation";
import { bookUrl } from "@/lib/booking-url";
import { searchServices } from "@/lib/services";
import { useAuthStore } from "@/stores/auth-store";

// No promo-code prompt: a code offered here would be one nobody issued.
const QUICK_PROMPTS = [
  "Book home cleaning tomorrow",
  "AC not cooling — need repair",
  "Cleaning for a 2BHK",
];

/**
 * A keyword shortcut to the booking page — it matches words in the message to a service. It is not
 * an AI model, so nothing here says it is, and it greets the signed-in customer by their own first
 * name or by none.
 */
export function AiAssistantSheet({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const firstName = useAuthStore((s) => s.user?.firstName?.trim() || null);
  const router = useRouter();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "ai"; text: string }[]
  >([]);
  const greeting = `Hi${firstName ? ` ${firstName}` : ""}! Tell me which service you need and I'll open its booking page.`;

  function reply(userText: string) {
    const q = userText.toLowerCase();
    let response = "Opening the booking page — pick a service there.";
    let href = bookUrl();

    // No prices, discounts or popularity here: the booking page shows the server's price.
    if (/\bac\b/.test(q) || q.includes("cooling")) {
      href = bookUrl({ service: "ac-service" });
      response = "Opening AC Service. The booking page shows the options and their prices.";
    } else if (q.includes("clean")) {
      href = bookUrl({ service: "deep-cleaning" });
      response = "Opening Home Cleaning. The booking page shows the options and their prices.";
    } else if (q.includes("plumb")) {
      href = bookUrl({ service: "plumbing" });
      response = "Opening Plumbing. The booking page shows the options and their prices.";
    } else if (q.includes("2bhk") || q.includes("package")) {
      href = bookUrl({ service: "deep-cleaning", package: 1 });
      response = "Opening Deep Cleaning. Compare the options and their prices on the booking page.";
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
      showToast("Opening the booking page", "info");
    }, 900);
  }

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    reply(text);
  }

  return (
    <Modal open={open} onClose={closeOverlay} title="Booking shortcut" size="md">
      <div className="mb-4 flex items-center gap-2 rounded-2xl bg-aurora/10 px-4 py-3 text-sm text-content">
        <Sparkles size={18} className="text-primary" />
        Type a service and jump straight to booking it
      </div>

      <div className="mb-4 flex max-h-52 flex-col gap-3 overflow-y-auto">
        {[{ role: "ai" as const, text: greeting }, ...messages].map((m, i) => (
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
          aria-label="Which service do you need?"
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
