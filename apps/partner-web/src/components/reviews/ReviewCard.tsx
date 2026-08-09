"use client";

import { useState } from "react";
import { IndianRupee, MessageCircle, Send, Star } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { useRespondToRatingMutation } from "@/hooks/use-partner-data";
import type { PartnerReview } from "@/types/partner";
import { formatDate } from "@/lib/format";

export function ReviewCard({ review }: { review: PartnerReview }) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const respond = useRespondToRatingMutation();

  const hasReply = !!review.providerResponse;

  async function submitReply() {
    const trimmed = reply.trim();
    if (!trimmed) return;
    try {
      await respond.mutateAsync({ ratingId: review.id, response: trimmed });
      setReplying(false);
      setReply("");
    } catch {
      /* toast already surfaced via mutation onError */
    }
  }

  return (
    <PartnerCard>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold">{review.user.firstName ?? "Customer"}</p>
          <p className="text-xs text-partner-muted">
            {formatDate(review.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-0.5 text-amber-400">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className={`h-3.5 w-3.5 ${
                i < review.rating ? "fill-current" : "opacity-30"
              }`}
            />
          ))}
        </div>
      </div>
      {review.reviewText ? (
        <p className="mt-3 text-sm text-partner-muted">{review.reviewText}</p>
      ) : (
        <p className="mt-3 text-sm italic text-partner-muted-dim">
          (No written review)
        </p>
      )}
      {review.tipAmount != null && review.tipAmount > 0 ? (
        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-partner-success">
          <IndianRupee className="h-3 w-3" />
          Tip ₹{review.tipAmount}
        </p>
      ) : null}

      {hasReply ? (
        <div className="mt-3 rounded-xl border border-partner-primary/20 bg-partner-primary/5 p-3">
          <p className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-partner-primary">
            <MessageCircle className="h-3 w-3" /> Your reply
          </p>
          <p className="text-xs text-partner-text">{review.providerResponse}</p>
        </div>
      ) : replying ? (
        <div className="mt-3 space-y-2">
          <textarea
            rows={3}
            value={reply}
            disabled={respond.isPending}
            maxLength={300}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Thank the customer or address their feedback…"
            className="w-full resize-none rounded-xl border border-partner-line bg-partner-bg/60 px-3 py-2 text-sm outline-none focus:border-partner-primary disabled:opacity-60"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={respond.isPending}
              onClick={() => {
                setReplying(false);
                setReply("");
              }}
              className="rounded-md border border-partner-line px-3 py-1.5 text-xs hover:bg-partner-bg/60 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={respond.isPending || reply.trim().length === 0}
              onClick={() => void submitReply()}
              className="flex items-center gap-1 rounded-md bg-partner-primary px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-60"
            >
              <Send className="h-3 w-3" />
              {respond.isPending ? "Posting…" : "Post reply"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setReplying(true)}
          className="mt-3 flex items-center gap-1 text-xs font-semibold text-partner-primary hover:underline"
        >
          <MessageCircle className="h-3 w-3" /> Reply to this review
        </button>
      )}
    </PartnerCard>
  );
}
