"use client";

import { ArrowRight, Play } from "lucide-react";
import { Button } from "@/components/buttons/Button";
import { ButtonLink } from "@/components/buttons/ButtonLink";
import { bookUrl } from "@/lib/booking-url";
import { useAppStore } from "@/stores/app-store";

/** Hero CTA pair — one primary + one secondary from the shared button system. */
export function HeroCtaButtons() {
  const openOverlay = useAppStore((s) => s.openOverlay);
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <ButtonLink href={bookUrl()} variant="primary" size="xl" className="group">
        Book a Service
        <ArrowRight
          size={20}
          aria-hidden
          className="transition-transform group-hover:translate-x-1"
        />
      </ButtonLink>
      <Button
        type="button"
        variant="secondary"
        size="xl"
        icon={<Play size={18} aria-hidden />}
        onClick={() => openOverlay("how-it-works")}
      >
        See How It Works
      </Button>
    </div>
  );
}
