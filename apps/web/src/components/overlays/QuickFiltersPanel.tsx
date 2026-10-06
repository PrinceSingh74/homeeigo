"use client";

import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";
import { bookUrl } from "@/lib/booking-url";
import { cn } from "@/lib/utils";

// Shortcuts to a service by name. Slugs match the backend catalog (services table).
// No price or popularity shortcut: neither was a catalogue query — both were a fixed link to one
// service under a label that claimed a price ceiling or a ranking.
const FILTERS = [
  { label: "AC & Cooling", href: bookUrl({ service: "ac-service" }) },
  { label: "Home Cleaning", href: bookUrl({ service: "deep-cleaning" }) },
  { label: "Bathroom Cleaning", href: bookUrl({ service: "bathroom-cleaning" }) },
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
        Jump straight to a service. Prices and availability are shown on the booking page.
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
