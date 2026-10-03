"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { bookUrl } from "@/lib/booking-url";
import { TileCaption } from "@/components/cards/TileCaption";

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
 * clear; a soft bottom-anchored scrim sits behind the caption so the top of the
 * image reads crisp. Caption layout (wrapping title, price chip, arrow) is the
 * shared TileCaption so every marketplace tile behaves identically.
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
        "group relative block aspect-[4/3] w-full min-w-0 overflow-hidden rounded-2xl text-left outline-none",
        "shadow-[0_16px_40px_-18px_rgb(15_23_42/0.5)]",
        "focus-visible:ring-2 focus-visible:ring-brand/70 focus-visible:ring-offset-2",
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
          alt=""
          fill
          quality={92}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 22vw"
          className="object-cover"
          onError={() => setImgFailed(true)}
        />
      ) : null}

      {/* Soft bottom-anchored scrim — tall enough for a wrapped two/three-line
          title while the upper part of the photo stays fully visible. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-slate-950/92 via-slate-950/45 to-transparent"
      />

      {/* Glass edge ring */}
      <span aria-hidden className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/20" />

      {/* Featured chip — glass */}
      {featured ? (
        <span className="absolute right-3 top-3 z-20 rounded-full bg-black/30 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white ring-1 ring-white/30 backdrop-blur-md">
          Popular
        </span>
      ) : null}

      <TileCaption
        title={name}
        accent={color}
        chip={
          <span className="inline-flex items-center rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-bold text-white ring-1 ring-white/25 backdrop-blur-sm">
            From {price}
          </span>
        }
      />
    </button>
  );
}
