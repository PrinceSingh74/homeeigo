import { ReviewCard } from "@/components/reviews/ReviewCard";
import { DEMO_REVIEWS } from "@/lib/partner-data";

export default function ReviewsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Reviews</h1>
        <p className="text-sm text-partner-muted">Customer feedback and tips</p>
      </div>
      <div className="space-y-3">
        {DEMO_REVIEWS.map((r) => (
          <ReviewCard key={r.id} review={r} />
        ))}
      </div>
    </div>
  );
}
