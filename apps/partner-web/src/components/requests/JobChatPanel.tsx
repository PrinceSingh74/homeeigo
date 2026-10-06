"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { partnerApi } from "@/services/partner-api";
import { getErrorMessage } from "@/lib/api-error";
import { formatTime } from "@/lib/format";
import { CHAT_CLOSED_MESSAGE, isChatClosedError, isChatOpen } from "@/lib/job-stage";
import { usePartnerStore } from "@/stores/partner-store";

/**
 * Chat with the customer of ONE job, for as long as the partner is serving it.
 *
 * The server closes chat (403 `CHAT_CLOSED`) once the job is no longer active. `status` lets the panel
 * know that without asking: when chat is closed it reads nothing, marks nothing read, shows no composer
 * and says so. A `CHAT_CLOSED` answer that arrives anyway (the job ended while the panel was open) is
 * shown as the same sentence, not as an error.
 */
export function JobChatPanel({
  bookingId,
  status,
  customerName,
  bookingNumber,
  phoneMasked,
}: {
  bookingId: string;
  /** The booking's status — decides whether chat is open (`isChatOpen`). */
  status: string | null | undefined;
  customerName: string;
  bookingNumber: string;
  phoneMasked?: string | null;
}) {
  const qc = useQueryClient();
  const myUserId = usePartnerStore((s) => s.user?.id);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const open = isChatOpen(status);

  const chatQuery = useQuery({
    queryKey: ["partner", "job-chat", bookingId],
    queryFn: () => partnerApi.listChat(bookingId, { limit: 50 }),
    enabled: open,
    // Stop polling the moment the server says the chat is closed.
    refetchInterval: (query) => (isChatClosedError(query.state.error) ? false : 8_000),
  });

  useEffect(() => {
    if (!open) return;
    void partnerApi.markChatRead(bookingId).catch(() => undefined);
  }, [bookingId, open, chatQuery.dataUpdatedAt]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatQuery.data?.messages.length]);

  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      partnerApi.sendChat(bookingId, body, `web-${Date.now()}`),
    onSuccess: () => {
      setDraft("");
      void qc.invalidateQueries({ queryKey: ["partner", "job-chat", bookingId] });
    },
  });

  const closed = !open || isChatClosedError(chatQuery.error) || isChatClosedError(sendMutation.error);
  const messages = closed ? [] : chatQuery.data?.messages ?? [];

  return (
    <PartnerCard hover={false} className="flex flex-col gap-3" data-testid="job-chat-panel">
      <div className="flex items-start justify-between gap-3 border-b border-partner-line pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-partner-primary/15">
            <MessageSquare className="h-4 w-4 text-partner-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-partner-text">{customerName}</p>
            <p className="text-[11px] text-partner-muted">
              {bookingNumber}
              {phoneMasked ? ` · ${phoneMasked}` : ""}
            </p>
          </div>
        </div>
      </div>

      {closed ? (
        <p role="status" data-testid="job-chat-closed" className="rounded-xl bg-partner-bg/60 px-3 py-6 text-center text-sm text-partner-muted">
          {CHAT_CLOSED_MESSAGE}
        </p>
      ) : (
      <>
      <div className="flex max-h-72 min-h-[10rem] flex-col gap-2 overflow-y-auto rounded-xl bg-partner-bg/60 p-3">
        {chatQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-partner-muted" />
          </div>
        ) : chatQuery.isError ? (
          <p className="py-6 text-center text-sm text-partner-danger">
            {getErrorMessage(chatQuery.error)}
          </p>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-partner-muted">
            No messages yet — say hello to the customer.
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
                      ? "bg-partner-primary text-white"
                      : "border border-partner-line bg-partner-card text-partner-text"
                  }`}
                >
                  {m.body}
                </div>
                <span className="mt-0.5 text-[10px] text-partner-muted">
                  {formatTime(m.createdAt)}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex gap-2"
        data-testid="job-chat-composer"
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
          placeholder="Type a message…"
          maxLength={2000}
          className="flex-1 rounded-xl border border-partner-line bg-partner-bg px-3 py-2.5 text-sm text-partner-text outline-none focus:border-partner-primary"
          aria-label="Chat message"
        />
        <PartnerButton
          type="submit"
          disabled={!draft.trim() || sendMutation.isPending}
          className="shrink-0 px-3"
          aria-label="Send message"
        >
          {sendMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
        </PartnerButton>
      </form>
      {sendMutation.isError ? (
        <p className="text-xs text-partner-danger">{getErrorMessage(sendMutation.error)}</p>
      ) : null}
      </>
      )}
    </PartnerCard>
  );
}
