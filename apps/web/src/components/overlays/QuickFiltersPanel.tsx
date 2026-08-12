"use client";

import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";
import { bookUrl } from "@/lib/booking-url";
import { cn } from "@/lib/utils";

// Slugs match the live backend catalog (services table), so each filter
// deep-links to a real bookable service.
const FILTERS = [
  { label: "Under ₹300", href: bookUrl({ service: "bathroom-cleaning" }) },
  { label: "Most Popular", href: bookUrl({ service: "deep-cleaning", package: 1 }) },
  { label: "AC & Cooling", href: bookUrl({ service: "ac-service" }) },
  { label: "Home Cleaning", href: bookUrl({ service: "deep-cleaning" }) },
  { label: "Plumbing & Repairs", href: bookUrl({ service: "plumbing" }) },
  { label: "Salon at Home", href: bookUrl({ service: "salon-at-home" }) },
  { label: "Express Party Clean", href: bookUrl({ service: "pre-party-express-clean" }) },
  { label: "Sofa & Carpet", href: bookUrl({ service: "sofa-deep-cleaning" }) },
];

export function QuickFiltersPanel({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const router = useRouter();

  return (
    <Modal open={open} onClose={closeOverlay} title="Quick filters" size="sm">
      <p className="mb-4 text-sm text-muted">
        Jump straight to what you need — we&apos;ll pre-select the best match.
      </p>
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => {
              closeOverlay();
              router.push(f.href);
            }}
            className={cn(
              "rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-content",
              "transition hover:border-primary hover:bg-primary/5 hover:text-primary",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
