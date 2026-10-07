import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Star } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { failureSentence } from "@/components/money/DataScreen";
import { Banner, Button, Card, EmptyState, Field, Pill, Sheet, T } from "@/components/ui";
import { K } from "@/hooks/money/queries";
import { formatDay, rupees, starsLabel } from "@/lib/money-format";
import { ratingBreakdownRows } from "@/lib/money-series";
import { partnerApi } from "@/services/partner-api";
import { color, radius, space } from "@/theme/tokens";
import type { PartnerReview } from "@/types/partner";

function Stars({ value }: { value: number }) {
  return (
    <View style={styles.stars} accessible accessibilityRole="image" accessibilityLabel={starsLabel(value)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={16} color={n <= value ? color.marigold : color.line} fill={n <= value ? color.marigold : "transparent"} />
      ))}
    </View>
  );
}

/**
 * How many reviews gave each star count, exactly as the server counts them. The server sends no
 * average rating on this answer, so none is shown or worked out here.
 */
export function RatingBreakdown({ breakdown, total }: { breakdown: Record<string, number>; total: number }) {
  const rows = ratingBreakdownRows(breakdown);
  return (
    <Card testID="rating-breakdown">
      <T kind="bodyStrong" numeric>{`${total} ${total === 1 ? "review" : "reviews"}`}</T>
      <View style={styles.breakdown}>
        {rows.map((r) => (
          <View key={r.stars} style={styles.breakdownRow} accessible accessibilityLabel={`${starsLabel(r.stars)}: ${r.count}`}>
            <T kind="small" numeric style={styles.breakdownLabel}>{`${r.stars} star`}</T>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(r.ratio * 100)}%` }]} />
            </View>
            <T kind="smallStrong" numeric style={styles.breakdownCount}>
              {String(r.count)}
            </T>
          </View>
        ))}
      </View>
    </Card>
  );
}

export function ReviewCard({ review, onReply, index }: { review: PartnerReview; onReply: (r: PartnerReview) => void; index: number }) {
  const photos = (Array.isArray(review.photos) ? review.photos : []).filter((p) => typeof p === "string" && /^https?:\/\//i.test(p));
  const tip = typeof review.tipAmount === "number" && review.tipAmount > 0 ? review.tipAmount : null;
  return (
    <Card testID={`review-${index}`}>
      <View style={styles.reviewHead}>
        <View style={styles.reviewWho}>
          <T kind="bodyStrong">{review.user?.firstName || "Customer"}</T>
          <T kind="caption" numeric>
            {formatDay(review.createdAt)}
          </T>
        </View>
        <Stars value={review.rating} />
      </View>
      {review.reviewText ? <T kind="body" style={styles.reviewText}>{review.reviewText}</T> : <T kind="small" style={styles.reviewText}>No written review.</T>}
      {photos.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos} style={styles.photoStrip}>
          {photos.map((uri, i) => (
            <Image key={`${uri}-${i}`} source={{ uri }} style={styles.photo} accessibilityLabel={`Customer photo ${i + 1} of ${photos.length}`} />
          ))}
        </ScrollView>
      ) : null}
      {tip !== null || review.helpfulCount > 0 ? (
        <View style={styles.meta}>
          {tip !== null ? <Pill label={`Tip ${rupees(tip)}`} tone="warning" /> : null}
          {review.helpfulCount > 0 ? <Pill label={`${review.helpfulCount} found this helpful`} /> : null}
        </View>
      ) : null}
      {review.providerResponse ? (
        <View style={styles.reply} testID={`review-${index}-reply`}>
          <T kind="smallStrong" tone="slate">{`Your reply${review.respondedAt ? ` · ${formatDay(review.respondedAt)}` : ""}`}</T>
          <T kind="body">{review.providerResponse}</T>
        </View>
      ) : null}
      <Button
        label={review.providerResponse ? "Edit reply" : "Reply"}
        accessibilityLabel={`${review.providerResponse ? "Edit your reply to" : "Reply to"} ${review.user?.firstName || "this customer"}`}
        icon={MessageSquare}
        variant="quiet"
        onPress={() => onReply(review)}
        testID={`review-${index}-reply-button`}
      />
    </Card>
  );
}

/**
 * Reply to a review (`POST /api/ratings/:id/respond`, 3–1000 characters; a second reply replaces
 * the first). On success the sheet shows the reply as the server stored it.
 */
export function ReplySheet({ review, onClose }: { review: PartnerReview | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const respond = useMutation({
    mutationFn: (input: { id: string; response: string }) => partnerApi.respondToRating(input.id, input.response),
    onSuccess: () => void qc.invalidateQueries({ queryKey: K.reviews }),
    onError: (e) => setError(failureSentence(e)),
  });
  const reset = respond.reset;
  const reviewId = review?.id ?? null;
  const existing = review?.providerResponse ?? "";

  useEffect(() => {
    setText(existing);
    setError(null);
    reset();
  }, [reviewId, existing, reset]);

  if (!review) return null;
  const trimmed = text.trim();

  function send() {
    if (!review || respond.isPending) return;
    if (trimmed.length < 3 || trimmed.length > 1000) {
      setError("Write a reply of 3 to 1,000 characters.");
      return;
    }
    setError(null);
    respond.mutate({ id: review.id, response: trimmed });
  }

  if (respond.isSuccess) {
    return (
      <Sheet visible onClose={onClose} title="Reply saved" testID="reply-sheet" footer={<Button label="Done" onPress={onClose} testID="reply-done" />}>
        <Banner tone="success" message="Your reply is saved and shown with the review." testID="reply-saved" />
        <View style={styles.reply}>
          <T kind="smallStrong" tone="slate">{`Your reply${respond.data.respondedAt ? ` · ${formatDay(respond.data.respondedAt)}` : ""}`}</T>
          <T kind="body" testID="reply-stored">
            {respond.data.providerResponse ?? ""}
          </T>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={existing ? "Edit reply" : "Reply to review"}
      dismissable={!respond.isPending}
      testID="reply-sheet"
      footer={
        <>
          <Button label={existing ? "Save reply" : "Send reply"} onPress={send} loading={respond.isPending} testID="reply-submit" />
          <Button label="Cancel" variant="quiet" onPress={onClose} disabled={respond.isPending} />
        </>
      }
    >
      <View style={styles.reviewHead}>
        <T kind="bodyStrong">{review.user?.firstName || "Customer"}</T>
        <Stars value={review.rating} />
      </View>
      {review.reviewText ? <T kind="small" tone="ink">{review.reviewText}</T> : null}
      <Field
        label="Your reply"
        value={text}
        onChangeText={(v) => {
          setText(v);
          if (error) setError(null);
        }}
        error={error}
        help={`${trimmed.length} of 1,000 characters. The customer can read your reply.${existing ? " Saving replaces your earlier reply." : ""}`}
        multiline
        maxLength={1000}
        editable={!respond.isPending}
        testID="reply-input"
      />
    </Sheet>
  );
}

export function NoReviews() {
  return (
    <Card>
      <EmptyState icon={Star} title="No reviews yet" message="When a customer rates a completed job, their review appears here and you can reply to it." testID="reviews-empty" />
    </Card>
  );
}

const styles = StyleSheet.create({
  stars: { flexDirection: "row", gap: 2 },
  breakdown: { marginTop: space.md, gap: space.sm },
  breakdownRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  breakdownLabel: { width: 48 },
  breakdownCount: { width: 36, textAlign: "right" },
  track: { flex: 1, height: 8, borderRadius: radius.pill, backgroundColor: color.well, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill, backgroundColor: color.marigold },
  reviewHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.md },
  reviewWho: { flex: 1, gap: 2 },
  reviewText: { marginTop: space.sm },
  photoStrip: { marginTop: space.md },
  photos: { gap: space.sm },
  photo: { width: 88, height: 88, borderRadius: radius.control, backgroundColor: color.well },
  meta: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
  reply: { marginTop: space.md, padding: space.md, borderRadius: radius.control, backgroundColor: color.well, gap: space.xs },
});
