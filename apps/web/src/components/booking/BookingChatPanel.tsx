"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { coreApi } from "@/services/core/api";
import { useAuthStore } from "@/stores/auth-store";
import { getErrorMessage } from "@/lib/auth/errors";

/**
 * Customer half of booking-scoped chat — same `/api/bookings/:id/chat` as partner.
 * No second chat engine; conversation is bookingId-bound on the backend.
 */
export function BookingChatPanel({
  bookingId,
  partnerName,
}: {
  bookingId: string;
  partnerName?: string | null;
}) {
  const qc = useQueryClient();
  const myUserId = useAuthStore((s) => s.user?.id);
  const [draft, setDraft] = useState("");
  const [pendingClientId, setPendingClientId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const chatQuery = useQuery({
    queryKey: ["customer", "job-chat", bookingId],
    queryFn: () => coreApi.bookings.listChat(bookingId, { limit: 50 }),
    refetchInterval: 8_000,
  });

  useEffect(() => {
    void coreApi.bookings.markChatRead(bookingId).catch(() => undefined);
  }, [bookingId, chatQuery.dataUpdatedAt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatQuery.data?.messages.length]);

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      const clientMessageId =
        pendingClientId ?? `cust-web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPendingClientId(clientMessageId);
      return coreApi.bookings.sendChat(bookingId, body, clientMessageId);
    },
    onSuccess: () => {
      setDraft("");
      setPendingClientId(null);
      void qc.invalidateQueries({ queryKey: ["customer", "job-chat", bookingId] });
    },
  });

  const messages = chatQuery.data?.messages ?? [];

  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface/70 p-4"
      data-testid="customer-booking-chat"
    >
      <div className="flex items-center gap-2 border-b border-line pb-3">
        <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-700">
          <MessageSquare className="size-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-content">
            Chat with {partnerName?.trim() || "your pro"}
          </p>
          <p className="text-[11px] text-muted">Private to this booking</p>
        </div>
      </div>

      <div className="flex max-h-64 min-h-[9rem] flex-col gap-2 overflow-y-auto rounded-xl bg-bg/50 p-3">
        {chatQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted" />
          </div>
        ) : chatQuery.isError ? (
          <p className="py-6 text-center text-sm text-error">
            {getErrorMessage(chatQuery.error)}
          </p>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            No messages yet — say hello to your pro.
          </p>
        ) : (
          messages.map((m) => {
            const mine = myUserId != null && m.senderUserId === myUserId;
            return (
              <div
                key={m.id}
                className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    mine
                      ? "bg-emerald-600 text-white"
                      : "border border-line bg-surface text-content"
                  }`}
                >
                  {m.body}
                </div>
                <span className="mt-0.5 text-[10px] text-muted">
                  {new Date(m.createdAt).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const body = draft.trim();
          if (!body || sendMutation.isPending) return;
          sendMutation.mutate(body);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          placeholder="Type a message…"
          className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 py-2.5 text-sm text-content outline-none focus:border-emerald-500/50"
          data-testid="customer-chat-input"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sendMutation.isPending}
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:opacity-40"
          aria-label="Send message"
          data-testid="customer-chat-send"
        >
          {sendMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </button>
      </form>
      {sendMutation.isError ? (
        <p className="text-xs text-error">{getErrorMessage(sendMutation.error)}</p>
      ) : null}
    </div>
  );
}
