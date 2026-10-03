import Image from "next/image";
import type { ReactNode } from "react";
import { Star } from "lucide-react";
import { CATEGORY_BY_ID, audienceSummary, type ServiceView } from "@/lib/catalog";
import { IconArt, eyebrow } from "@/components/services-catalog/primitives";
import { ServicePricing } from "@/components/services-catalog/detail/sections";
import { cn } from "@/lib/utils";

/** YouTube and Vimeo page links cannot play in a <video> tag — they need their embed player. */
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

export function ServiceHero({
  service,
  rating,
  image,
  children,
  treatment = "default",
}: {
  service: ServiceView;
  rating: { value: number; count: number } | null;
  /** Admin gallery image, when configured. */
  image?: string;
  children?: ReactNode;
  treatment?: "default" | "home-help";
}) {
  const cat = CATEGORY_BY_ID.get(service.category)!;
  const src = image ?? (service.status === "live" ? service.image : undefined);
  const video = service.status === "live" ? service.video : undefined;
  const embed = video ? videoEmbed(video) : null;
  const live = service.status === "live";
  const editorial = treatment === "home-help";

  return (
    <div className={cn("grid items-center gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14", editorial && "lg:items-start")}>
      <div className="order-last space-y-3 lg:order-first">
        {(src || !(embed || video)) && (
          <div
            className={cn(
              "relative aspect-[4/3] overflow-hidden bg-canvas shadow-e3 group",
              editorial ? "rounded-[2.25rem] sm:rounded-[2.75rem]" : "rounded-3xl",
            )}
          >
            {src ? (
              <Image
                src={src}
                alt={`${service.name} by a HOMEEIGO professional`}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 600px"
                className="object-cover object-[50%_25%]"
              />
            ) : (
              <IconArt icon={service.icon} tone={service.tone} muted={!live} />
            )}
          </div>
        )}
        {embed ? (
          <div className={cn("relative aspect-video overflow-hidden bg-canvas shadow-e3", editorial ? "rounded-[2rem]" : "rounded-3xl")}>
            <iframe
              src={embed}
              title={`${service.name} video`}
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : video ? (
          <div className={cn("relative aspect-video overflow-hidden bg-canvas shadow-e3", editorial ? "rounded-[2rem]" : "rounded-3xl")}>
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

      <div className="motion-safe:animate-catalog-in">
        <p className={eyebrow}>
          {cat.name}
          {service.category === "beauty" && service.audiences.length > 0 && ` · ${audienceSummary(service.audiences)}`}
        </p>
        <h1
          className={cn(
            "mt-3 font-display font-bold tracking-tight text-content",
            editorial ? "text-[clamp(2rem,5vw,3.25rem)] leading-[1.02]" : "type-title",
          )}
        >
          {service.name}
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">{service.description}</p>

        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {rating ? (
            <span className="inline-flex items-center gap-1.5 text-content">
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
            live && <span className="text-muted">No reviews yet</span>
          )}
          {!live && (
            <span className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-muted">
              Coming soon
            </span>
          )}
        </div>

        <div className={cn("mt-6 border-t border-line pt-6")}>
          <ServicePricing service={service} />
        </div>
        {children}
      </div>
    </div>
  );
}
