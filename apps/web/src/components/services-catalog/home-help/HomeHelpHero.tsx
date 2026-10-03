import type { ReactNode } from "react";
import { Clock3, Star } from "lucide-react";
import { formatDuration, priceText, type ServiceView } from "@/lib/catalog";
import { brandChip } from "@/components/layout/BrandCanvas";
import { HomeHelpPhoto } from "@/components/services-catalog/home-help/HomeHelpPhoto";
import { homeHelpPhoto } from "@/components/services-catalog/home-help/home-help-photo";
import { cn } from "@/lib/utils";

function videoEmbed(url: string): string | null {
  try {
    const u = new URL(url, "https://homeeigo.local");
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = u.searchParams.get("v") ?? u.pathname.split("/").filter(Boolean).pop();
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === "vimeo.com") {
      const id = u.pathname.split("/").filter(Boolean).pop();
      return id && /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function HomeHelpHero({
  service,
  rating,
  image,
  children,
}: {
  service: ServiceView;
  rating: { value: number; count: number } | null;
  image?: string;
  children?: ReactNode;
}) {
  const src = homeHelpPhoto({ ...service, image: image ?? service.image });
  const video = service.status === "live" ? service.video : undefined;
  const embed = video ? videoEmbed(video) : null;
  const live = service.status === "live";
  const price = priceText(service);
  const duration = live ? formatDuration(service.durationMin) : null;

  return (
    <div className="relative">
      <div className="relative grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
        <div className="motion-safe:animate-catalog-in">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#163326]/55 dark:text-muted">Home Help</p>
          <h1 className="mt-5 font-display text-[clamp(2.15rem,6vw,3.75rem)] font-bold leading-[0.96] tracking-tight text-[#163326] dark:text-content">
            {service.name}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">{service.description}</p>

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            {rating ? (
              <span className={brandChip}>
                <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden />
                <span className="font-semibold tabular-nums">{rating.value.toFixed(1)}</span>
                <span className="text-muted">
                  ({rating.count} {rating.count === 1 ? "review" : "reviews"})
                </span>
                <span className="sr-only">
                  Rated {rating.value.toFixed(1)} out of 5 from {rating.count} reviews
                </span>
              </span>
            ) : (
              live && <span className="text-sm text-muted">No reviews yet</span>
            )}
            {!live && (
              <span className={cn(brandChip, "rounded-2xl text-xs font-semibold")}>Coming soon</span>
            )}
            {duration && (
              <span className={cn(brandChip, "rounded-2xl")}>
                <Clock3 className="size-3.5 text-brand" aria-hidden />
                {duration}
              </span>
            )}
          </div>

          <div className="mt-8 flex flex-wrap items-end gap-4">
            <p className="font-display text-[clamp(2rem,4vw,2.75rem)] font-bold tabular-nums leading-none text-content">
              <span aria-hidden>{price.label}</span>
              <span className="sr-only">Price: {price.spoken}</span>
            </p>
            <span className="mb-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
              {service.hourly || service.pricingModel === "hourly" ? "By the hour" : "Single task"}
            </span>
          </div>
          {children}
        </div>

        <div className="relative mx-auto w-full max-w-lg lg:mx-0 lg:max-w-none">
          <span
            aria-hidden
            className="absolute -left-6 top-8 hidden size-24 rounded-full border border-emerald-500/25 lg:block"
          />
          <span
            aria-hidden
            className="absolute -right-4 bottom-10 hidden size-16 rounded-[1.25rem] bg-teal-400/20 lg:block"
          />
          <HomeHelpPhoto
            src={src}
            alt={`${service.name} by a HOMEEIGO professional`}
            priority
            sizes="(max-width: 1024px) 90vw, 560px"
            className="mx-auto aspect-square w-[90%] rounded-full shadow-[0_32px_90px_-28px_rgb(22_51_38/0.32)] ring-8 ring-white lg:w-[94%] dark:ring-canvas"
          />
          {embed ? (
            <div className="relative mt-3 aspect-video overflow-hidden rounded-[1.75rem] bg-surface ring-1 ring-line sm:rounded-[2rem]">
              <iframe
                src={embed}
                title={`${service.name} video`}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : video ? (
            <div className="relative mt-3 aspect-video overflow-hidden rounded-[1.75rem] bg-surface ring-1 ring-line sm:rounded-[2rem]">
              <video
                src={video}
                poster={src}
                controls
                playsInline
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
