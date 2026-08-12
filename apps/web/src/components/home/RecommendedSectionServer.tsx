import Link from "next/link";
import { Star } from "lucide-react";
import { PageSection } from "@/components/layout/PageSection";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { ServiceImage } from "@/components/ui/ServiceImage";
import { RECOMMENDED } from "@/lib/services";
import { bookUrl } from "@/lib/booking-url";
import { sectionAction } from "@/lib/page-layout";
import type { BackendService } from "@/types/backend";

export function RecommendedSectionServer({
  featured,
}: {
  featured: BackendService[] | null;
}) {
  const staticItems = RECOMMENDED.length
    ? RECOMMENDED
    : [
        {
          title: "Service",
          price: "₹0",
          rating: "4.8",
          serviceId: "service-unavailable",
          packageIndex: 0,
          img: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&q=75",
        },
      ];

  const items =
    featured?.slice(0, 4).map((s, i) => {
      const fallbackImg = staticItems[i % staticItems.length]!.img;
      const img =
        [s.thumbnail, s.icon, fallbackImg].find((v) => typeof v === "string" && v.trim()) ??
        fallbackImg;
      return {
        title: s.name,
        price: `₹${s.basePrice ?? s.minPrice ?? 0}`,
        rating: s.rating != null ? String(s.rating) : "New",
        serviceId: s.id,
        img,
      };
    }) ?? staticItems;

  return (
    <PageSection>
      <SectionHeader
        title="Recommended for You"
        action={
          <Link href={bookUrl()} className={sectionAction}>
            See all
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
        {items.map((it, i) => (
          <Link
            key={`${it.serviceId}-${i}`}
            href={bookUrl({ service: it.serviceId })}
            className="group relative overflow-hidden rounded-[24px] glass-card glass-reflect card-sheen card-3d p-4 text-left hover:shadow-[0_32px_64px_-16px_rgb(37_99_235/0.28)] sm:rounded-[28px] sm:p-5"
          >
            <span className="relative mb-4 block overflow-hidden rounded-2xl">
              <ServiceImage
                src={it.img}
                alt=""
                className="h-36 w-full object-cover transition-transform duration-500 group-hover:scale-110 sm:h-40"
              />
              <span
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />
              <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-white/85 px-2 py-1 text-xs font-semibold text-content shadow-e1 backdrop-blur-md dark:bg-black/55 dark:text-white">
                <Star size={12} className="fill-gold text-gold" />
                {it.rating}
              </span>
            </span>
            <p className="font-display text-base font-bold text-content">{it.title}</p>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 font-bold text-primary">
                {it.price}
              </span>
              <span className="text-xs font-semibold text-primary opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                Book now →
              </span>
            </div>
          </Link>
        ))}
      </div>
    </PageSection>
  );
}
