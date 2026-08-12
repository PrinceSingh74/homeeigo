"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Clock } from "lucide-react";
import { PageSection } from "@/components/layout/PageSection";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { sectionAction } from "@/lib/page-layout";
import { useMarketplaceSections } from "@/hooks/use-marketplace-sections";

type CategoryCard = {
  key: string;
  emoji: string;
  title: string;
  subtitle: string;
  href: string;
  accent: string;
  /** Representative branded artwork; omitted for the "Coming Soon" tile. */
  image?: string;
  soon?: boolean;
};

const CATEGORIES: CategoryCard[] = [
  { key: "hourly", emoji: "⏱️", title: "Hourly Bookings", subtitle: "Flexible help, by the hour", href: "/services", accent: "#0ea5e9", image: "/services/sweeping-mopping.png" },
  { key: "home-care", emoji: "🏠", title: "Home Care", subtitle: "Daily cleaning essentials", href: "/services#home-care", accent: "#22c55e", image: "/services/dusting-wiping.png" },
  { key: "premium-care", emoji: "✨", title: "Premium Care", subtitle: "Deep cleaning, healthier home", href: "/services#premium-care", accent: "#8b5cf6", image: "/services/bathroom-cleaning.png" },
  { key: "laundry", emoji: "👕", title: "Laundry & Wardrobe", subtitle: "Fresh, clean & well-organized", href: "/services#laundry", accent: "#0284c7", image: "/services/laundry.png" },
  { key: "outdoor", emoji: "🌳", title: "Outdoor", subtitle: "Care beyond your home", href: "/services#outdoor", accent: "#84cc16", image: "/services/balcony-cleaning.png" },
  { key: "express", emoji: "⚡", title: "Express Services", subtitle: "For your special occasions", href: "/services#express", accent: "#f59e0b", image: "/services/after-party.png" },
  { key: "coming-soon", emoji: "🔜", title: "Coming Soon", subtitle: "New services on the way", href: "/services#coming-soon", accent: "#64748b", soon: true },
];

/**
 * Premium "browse by category" wall for the home page — mirrors the services
 * page's category structure (same subcategories + Coming Soon) and shows a live
 * service count per category so home and /services stay in perfect parity.
 */
export function CategoryShowcase() {
  const { homeCare, premiumCare, laundry, outdoor, express } = useMarketplaceSections();

  const countFor: Record<string, number | null> = {
    hourly: null,
    "home-care": homeCare.length,
    "premium-care": premiumCare.length,
    laundry: laundry.length,
    outdoor: outdoor.length,
    express: express.length,
    "coming-soon": null,
  };

  return (
    <PageSection>
      <SectionHeader
        title="Explore by Category"
        action={
          <Link href="/services" className={`${sectionAction} inline-flex items-center gap-1`}>
            View all
            <ArrowRight size={16} aria-hidden />
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 lg:gap-6">
        {CATEGORIES.map((c) => {
          const count = countFor[c.key];
          return (
            <Link
              key={c.key}
              href={c.href}
              className="group relative block aspect-[4/3] w-full min-w-0 overflow-hidden rounded-3xl text-left outline-none shadow-[0_16px_40px_-18px_rgb(15_23_42/0.5)] focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2"
            >
              {/* Artwork or accent-gradient canvas (Coming Soon) */}
              <span
                aria-hidden
                className="absolute inset-0"
                style={{ background: `linear-gradient(160deg, ${c.accent}D9 0%, #1e293b 100%)` }}
              />
              {c.image ? (
                <Image
                  src={c.image}
                  alt={c.title}
                  fill
                  quality={90}
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 22vw"
                  className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.05]"
                />
              ) : (
                <span aria-hidden className="absolute inset-0 grid place-items-center text-6xl opacity-25">
                  {c.emoji}
                </span>
              )}

              {/* Readability gradient */}
              <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/15 to-slate-950/10" />
              <span aria-hidden className="absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/15" />

              {/* Emoji chip — glass */}
              <span className="absolute left-3 top-3 z-10 grid size-9 place-items-center rounded-xl bg-white/15 text-lg ring-1 ring-white/25 backdrop-blur-md">
                <span aria-hidden>{c.emoji}</span>
              </span>

              {/* Count / Soon badge — glass */}
              <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-slate-950/45 px-2.5 py-1 text-[11px] font-semibold text-white ring-1 ring-white/20 backdrop-blur-md">
                {c.soon ? (
                  <>
                    <Clock size={11} /> Soon
                  </>
                ) : count != null ? (
                  `${count} service${count === 1 ? "" : "s"}`
                ) : (
                  "By the hour"
                )}
              </span>

              {/* Label + arrow */}
              <span className="absolute inset-x-3.5 bottom-3 z-10 flex items-end justify-between gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold leading-tight text-white drop-shadow-[0_1px_3px_rgb(0_0_0/0.7)]">
                    {c.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] font-medium text-white/80 drop-shadow-[0_1px_2px_rgb(0_0_0/0.7)]">
                    {c.subtitle}
                  </span>
                </span>
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-full text-white shadow-md ring-1 ring-white/30 transition-transform duration-300 group-hover:translate-x-0.5"
                  style={{ background: c.accent }}
                >
                  <ArrowRight size={15} strokeWidth={2.5} aria-hidden />
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </PageSection>
  );
}
