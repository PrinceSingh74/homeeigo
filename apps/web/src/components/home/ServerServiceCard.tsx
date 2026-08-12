import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ServiceImage } from "@/components/ui/ServiceImage";
import { cn } from "@/lib/utils";
import { bookUrl } from "@/lib/booking-url";
import { PremiumRibbon } from "@/components/membership/PremiumRibbon";

export function ServerServiceCard({
  serviceId,
  img,
  name,
  price,
  color,
  featured = false,
  premiumOnly = false,
}: {
  serviceId: string;
  img?: string;
  name: string;
  price: string;
  color: string;
  featured?: boolean;
  premiumOnly?: boolean;
}) {
  return (
    <Link
      href={bookUrl({ service: serviceId })}
      className={cn(
        "group relative flex h-[17.5rem] w-full min-w-0 flex-col items-center sm:h-80 lg:h-88",
        "justify-center gap-3 overflow-hidden rounded-[24px] p-4 text-center sm:gap-4 sm:rounded-[32px] sm:p-6",
        "glass-card glass-reflect card-sheen card-3d",
        "hover:shadow-[0_32px_64px_-16px_rgb(37_99_235/0.3),0_2px_8px_-2px_rgb(15_23_42/0.1)]",
      )}
    >
      {featured ? <PremiumRibbon /> : null}
      <span
        aria-hidden
        className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${color}26 0%, transparent 70%)`,
        }}
      />
      <span className="relative z-10 transition-transform duration-300 group-hover:scale-105">
        <span
          aria-hidden
          className="absolute -inset-2 rounded-3xl opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-60"
          style={{ background: `${color}33` }}
        />
        <ServiceImage
          src={img}
          alt=""
          className="relative size-20 rounded-2xl object-cover shadow-e3 sm:size-24"
        />
      </span>
      <div className="relative z-10 min-w-0">
        <p className="truncate font-display text-base font-bold text-content sm:text-lg">
          {name}
        </p>
        <p className="mt-1.5 inline-flex rounded-full bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
          {price}
        </p>
        {premiumOnly ? (
          <p className="mt-1 text-[11px] font-medium text-gold">Premium</p>
        ) : null}
      </div>
      <span
        aria-hidden
        className="absolute bottom-4 right-4 z-10 grid size-8 place-items-center rounded-full bg-primary/10 text-primary opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 sm:bottom-5 sm:right-5 -translate-x-1.5"
      >
        <ArrowUpRight size={16} />
      </span>
    </Link>
  );
}
