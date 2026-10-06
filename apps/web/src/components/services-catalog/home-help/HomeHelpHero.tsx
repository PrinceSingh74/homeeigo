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
          <p className="text-sm font-medium text-brand">Home Help</p>
          <h1 className="mt-2 font-display type-display font-bold tracking-tight text-content">{service.name}</h1>
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
            <p className="font-display type-title font-bold tabular-nums leading-none text-content">
              <span aria-hidden>{price.label}</span>
              <span className="sr-only">Price: {price.spoken}</span>
            </p>
            <span className="mb-1 text-sm font-medium text-brand">
              {service.hourly || service.pricingModel === "hourly" ? "By the hour" : "Single task"}
            </span>
          </div>
          {children}
        </div>

        <div className="relative mx-auto w-full max-w-lg lg:mx-0 lg:max-w-none">
          <HomeHelpPhoto
            src={src}
            alt={`${service.name} by a HOMEEIGO professional`}
            priority
            sizes="(max-width: 1024px) 90vw, 560px"
            className="aspect-[4/3] w-full rounded-3xl shadow-e3"
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
