import { ReviewsOverview } from "@/components/reviews/ReviewsOverview";

export default function ReviewsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Customer reviews</h1>
        <p className="text-sm text-partner-muted">
          Ratings, feedback, and your public reputation
        </p>
      </div>
      <ReviewsOverview />
    </div>
  );
}
