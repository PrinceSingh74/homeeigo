import { Star, IndianRupee } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import type { PartnerReview } from "@/lib/partner-data";

export function ReviewCard({ review }: { review: PartnerReview }) {
  return (
    <PartnerCard>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold">{review.customerName}</p>
          <p className="text-xs text-partner-muted">
            {review.category} · {review.date}
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
      <p className="mt-3 text-sm text-partner-muted">{review.text}</p>
      {review.tip != null && (
        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-partner-success">
          <IndianRupee className="h-3 w-3" />
          Tip ₹{review.tip}
        </p>
      )}
    </PartnerCard>
  );
}
