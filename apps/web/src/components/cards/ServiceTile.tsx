"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { bookUrl } from "@/lib/booking-url";

export interface ServiceTileProps {
  serviceId: string;
  /** Kept for API compatibility; not rendered in the glass photo card. */
  icon?: LucideIcon;
  name: string;
  price: string;
  color: string;
  /** Full-bleed card artwork. Falls back to the brand-gradient canvas if absent/unreachable. */
  photo?: string;
  featured?: boolean;
  index?: number;
}

/**
 * Premium service card — fully static (no tilt / hover / zoom). The photo stays
 * fully clear: instead of a solid glass bar, only a soft bottom-anchored scrim
 * sits behind the name + price, so the top ~60% of the image reads crisp. Every
 * tile is the same fixed size.
 */
export function ServiceTile({
  serviceId,
  name,
  price,
  color,
  photo,
  featured = false,
}: ServiceTileProps) {
  const router = useRouter();
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={() => router.push(bookUrl({ service: serviceId }))}
      className={cn(
        "group relative block aspect-[4/3] w-full min-w-0 overflow-hidden rounded-3xl text-left outline-none",
        "shadow-[0_16px_40px_-18px_rgb(15_23_42/0.5)]",
        "focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2",
      )}
    >
      {/* Brand-gradient fallback — only visible if the image is missing/unreachable */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{ background: `linear-gradient(160deg, ${color}CC 0%, #1e293b 100%)` }}
      />

      {/* Full-bleed HD photo — stays clear, no motion */}
      {photo && !imgFailed ? (
        <Image
          src={photo}
          alt={name}
          fill
          quality={92}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 22vw"
          className="object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : null}

      {/* Soft bottom-anchored scrim — darkens only the lower third so the photo
          above stays fully visible while the label keeps its legibility. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-slate-950/92 via-slate-950/35 to-transparent"
      />

      {/* Glass edge ring */}
      <span aria-hidden className="absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/20" />

      {/* Featured chip — glass */}
      {featured ? (
        <span className="absolute right-3 top-3 z-20 rounded-full bg-black/30 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-white ring-1 ring-white/30 backdrop-blur-md">
          Popular
        </span>
      ) : null}

      {/* Label + arrow — text sits directly on the scrim (no blocking bar) */}
      <span className="absolute inset-x-3.5 bottom-3 z-20 flex items-end justify-between gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-extrabold leading-tight text-white drop-shadow-[0_2px_5px_rgb(0_0_0/0.85)]">
            {name}
          </span>
          <span className="mt-1 inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold text-white ring-1 ring-white/25 backdrop-blur-sm">
            From {price}
          </span>
        </span>
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full text-white shadow-lg ring-1 ring-white/40"
          style={{ background: color }}
        >
          <ArrowRight size={16} strokeWidth={2.6} aria-hidden />
        </span>
      </span>
    </button>
  );
}
