"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Star, ThumbsUp, ThumbsDown } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/buttons/Button";
import { ImageDropzone } from "@/components/upload/ImageDropzone";
import { useImageUpload } from "@/hooks/use-image-upload";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import {
  useRatingByBookingQuery,
  useSubmitRatingMutation,
  useUpdateRatingMutation,
} from "@/hooks/use-core-data";

const QUICK_LIKES = [
  "On time",
  "Polite & professional",
  "Quality work",
  "Cleaned up after",
  "Fair pricing",
  "Detailed expertise",
] as const;

const QUICK_IMPROVES = [
  "Was a bit late",
  "Communication",
  "Tools & equipment",
  "Cleanup",
  "Pricing transparency",
] as const;

type RatingModalProps = {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  serviceName?: string;
  providerName?: string;
  maxTip?: number;
};

export function RatingModal({
  open,
  onClose,
  bookingId,
  serviceName,
  providerName,
  maxTip = 500,
}: RatingModalProps) {
  const ratingQuery = useRatingByBookingQuery(open ? bookingId : undefined);
  const submitMutation = useSubmitRatingMutation();
  const updateMutation = useUpdateRatingMutation();
  const upload = useImageUpload({
    endpoint: "/api/uploads/ratings",
    maxItems: 4,
    compression: { maxDimension: 1600, quality: 0.82, mimeType: "image/webp" },
  });

  const existing = ratingQuery.data;
  const isEditing = !!existing;

  const [stars, setStars] = useState<number>(5);
  const [hoverStars, setHoverStars] = useState<number>(0);
  const [reviewText, setReviewText] = useState<string>("");
  const [tipAmount, setTipAmount] = useState<number>(0);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [couldImprove, setCouldImprove] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setStars(existing.rating ?? 5);
      setReviewText(existing.reviewText ?? "");
      setTipAmount(existing.tipAmount ?? 0);
      setLiked(new Set(existing.liked ?? []));
      setCouldImprove(new Set(existing.couldImprove ?? []));
    } else {
      setStars(5);
      setReviewText("");
      setTipAmount(0);
      setLiked(new Set());
      setCouldImprove(new Set());
      upload.reset();
    }
    // upload is stable from hook, intentionally only reset on open transition
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing]);

  function toggle(set: Set<string>, value: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  }

  const showToast = useAppStore((s) => s.showToast);
  const isSaving = submitMutation.isPending || updateMutation.isPending;
  const photos = upload.getCompletedUrls();
  const photosUploading = upload.isUploading;

  // Review is optional, but if written it must be at least 10 characters.
  const reviewTrimmed = reviewText.trim();
  const reviewTooShort = reviewTrimmed.length > 0 && reviewTrimmed.length < 10;

  async function handleSubmit() {
    if (stars < 1 || stars > 5) return;
    if (reviewTooShort) return; // guarded by the disabled button too
    const reviewToSend = reviewTrimmed.length >= 10 ? reviewTrimmed : undefined;
    const tagsLiked = Array.from(liked);
    const tagsImprove = Array.from(couldImprove);

    try {
      if (isEditing && existing) {
        await updateMutation.mutateAsync({
          ratingId: existing.id,
          payload: {
            rating: stars,
            reviewText: reviewToSend,
            photos: photos.length ? photos : undefined,
          },
        });
      } else {
        await submitMutation.mutateAsync({
          bookingId,
          rating: stars,
          reviewText: reviewToSend,
          tipAmount: tipAmount > 0 ? tipAmount : undefined,
          liked: tagsLiked.length ? tagsLiked : undefined,
          couldImprove: tagsImprove.length ? tagsImprove : undefined,
          photos: photos.length ? photos : undefined,
        });
      }
      showToast(isEditing ? "Review updated" : "Thanks for your review!", "success");
      onClose();
    } catch {
      // Never let the error bubble to the dev overlay — show a friendly toast instead.
      showToast("Could not submit your review. Please try again.", "error");
    }
  }

  const ratingLabel = useMemo(() => {
    const value = hoverStars || stars;
    if (value <= 1) return "Disappointing";
    if (value === 2) return "Below expectations";
    if (value === 3) return "Decent";
    if (value === 4) return "Great";
    return "Excellent";
  }, [hoverStars, stars]);

  return (
    <Modal open={open} onClose={onClose} title={isEditing ? "Edit your review" : "Rate your experience"} size="md">
      {ratingQuery.isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-6 animate-spin text-primary" aria-label="Loading" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="text-center">
            {serviceName ? (
              <p className="text-sm font-semibold text-content">{serviceName}</p>
            ) : null}
            {providerName ? (
              <p className="text-xs text-muted">with {providerName}</p>
            ) : null}
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => {
                const filled = (hoverStars || stars) >= n;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} stars`}
                    onMouseEnter={() => setHoverStars(n)}
                    onMouseLeave={() => setHoverStars(0)}
                    onFocus={() => setHoverStars(n)}
                    onBlur={() => setHoverStars(0)}
                    onClick={() => setStars(n)}
                    disabled={isSaving}
                    className="rounded-full p-1 transition disabled:opacity-60"
                  >
                    <Star
                      size={36}
                      className={cn(
                        "transition",
                        filled ? "fill-amber-400 text-amber-400" : "text-muted/40",
                      )}
                    />
                  </button>
                );
              })}
            </div>
            <p className="text-sm font-bold text-content" aria-live="polite">
              {ratingLabel}
            </p>
          </div>

          {!isEditing ? (
            <>
              <section>
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
                  <ThumbsUp size={12} /> What went well
                </p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_LIKES.map((tag) => {
                    const active = liked.has(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggle(liked, tag, setLiked)}
                        disabled={isSaving}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60",
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-line bg-surface text-content hover:border-primary/40",
                        )}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </section>

              {stars <= 3 ? (
                <section>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted">
                    <ThumbsDown size={12} /> What could improve
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_IMPROVES.map((tag) => {
                      const active = couldImprove.has(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggle(couldImprove, tag, setCouldImprove)}
                          disabled={isSaving}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60",
                            active
                              ? "border-error bg-error/10 text-error"
                              : "border-line bg-surface text-content hover:border-error/40",
                          )}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </>
          ) : null}

          <section>
            <label htmlFor="review-text" className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">
              Tell us more (optional)
            </label>
            <textarea
              id="review-text"
              rows={4}
              value={reviewText}
              maxLength={500}
              disabled={isSaving}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="Share details about your experience to help other customers"
              className="w-full resize-none rounded-2xl border border-line bg-surface px-4 py-3 text-sm text-content placeholder:text-muted focus:border-primary focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className={reviewTooShort ? "text-error" : "text-muted"}>
                {reviewTooShort ? "Add at least 10 characters, or leave it blank." : "Optional"}
              </span>
              <span className="text-muted">{reviewText.length}/500</span>
            </div>
          </section>

          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
              Add photos (optional)
            </p>
            <ImageDropzone
              items={upload.items}
              onFiles={(files) => upload.enqueue(files)}
              onRemove={(id) => upload.removeItem(id)}
              onCancel={(id) => upload.cancel(id)}
              onRetry={(id) => upload.retry(id)}
              disabled={isSaving}
              maxItems={4}
            />
          </section>

          {!isEditing ? (
            <section>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                Leave a tip (optional)
              </p>
              <div className="flex flex-wrap gap-2">
                {[0, 50, 100, 200, maxTip].map((amt, idx) => (
                  <button
                    key={`${amt}-${idx}`}
                    type="button"
                    onClick={() => setTipAmount(amt)}
                    disabled={isSaving}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm font-bold transition disabled:opacity-60",
                      tipAmount === amt
                        ? "border-primary bg-primary text-white"
                        : "border-line bg-surface text-content hover:border-primary/40",
                    )}
                  >
                    {amt === 0 ? "No tip" : `₹${amt}`}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              isLoading={isSaving}
              disabled={isSaving || stars < 1 || photosUploading || reviewTooShort}
            >
              {photosUploading
                ? "Waiting for photos…"
                : reviewTooShort
                  ? "Min 10 characters"
                  : isEditing
                    ? "Update review"
                    : "Submit review"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
