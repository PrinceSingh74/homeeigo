import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { CATEGORY_BY_ID, audienceSummary, categoryHref, type ServiceView } from "@/lib/catalog";
import { IconTile, focusRing } from "@/components/services-catalog/primitives";
import { ServicePricing, ServiceRating } from "@/components/services-catalog/detail/sections";
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
}: {
  service: ServiceView;
  rating: { value: number; count: number } | null;
  /** Admin gallery image, when configured. */
  image?: string;
  children?: ReactNode;
}) {
  const cat = CATEGORY_BY_ID.get(service.category)!;
  const src = image ?? (service.status === "live" ? service.image : undefined);
  const video = service.status === "live" ? service.video : undefined;
  const embed = video ? videoEmbed(video) : null;
  const live = service.status === "live";
  const hasMedia = Boolean(src || embed || video);
  // The category is already the breadcrumb above; here it is one quiet link, with the beauty
  // audience (when there is one) written as words.
  const audiences = service.category === "beauty" ? audienceSummary(service.audiences) : null;

  const intro = (
    <>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
        {!hasMedia && (
          <IconTile icon={service.icon} tone={service.tone} className="size-11 rounded-2xl" iconClassName="size-5" />
        )}
        <Link href={categoryHref(cat.id)} className={cn("rounded-md font-medium text-brand underline-offset-4 hover:underline", focusRing)}>
          {cat.name}
        </Link>
        {audiences && <span>For {audiences.split(" · ").join(", ").replace(/^All ages$/, "all ages")}</span>}
        {!live && (
          <span className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-content">Coming soon</span>
        )}
      </p>
      <h1
        className={cn(
          "mt-4 text-balance font-display font-bold tracking-tight text-content",
          hasMedia ? "type-title" : "type-display",
        )}
      >
        {service.name}
      </h1>
      <p className={cn("mt-4 max-w-2xl leading-relaxed text-muted", hasMedia ? "text-lg" : "text-lg sm:text-xl")}>{service.description}</p>
      {(rating || live) && (
        <div className="mt-4">
          <ServiceRating rating={rating} live={live} />
        </div>
      )}
    </>
  );

  // No photo and no video: a type-led hero. The title carries the page; the facts sit on a rule
  // beneath it. There is deliberately no panel standing in for a picture.
  if (!hasMedia) {
    return (
      <div className="motion-safe:animate-catalog-in">
        <div className="grid items-end gap-x-14 gap-y-8 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="max-w-4xl">{intro}</div>
          {/* Small screens: under the title on a rule. Wide screens: set against the title's baseline. */}
          <div className="border-t border-line pt-7 lg:border-l lg:border-t-0 lg:py-2 lg:pl-14">
            <ServicePricing service={service} />
          </div>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="grid items-center gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-14">
      <div className="motion-safe:animate-catalog-in">
        {intro}
        <div className="mt-7 border-t border-line pt-7">
          <ServicePricing service={service} />
        </div>
        {children}
      </div>

      <div className="space-y-3">
        {src && (
          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-canvas shadow-e3">
            <Image
              src={src}
              alt={`${service.name} by a HOMEEIGO professional`}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 680px"
              className="object-cover object-[50%_25%]"
            />
          </div>
        )}
        {embed ? (
          <div className="relative aspect-video overflow-hidden rounded-3xl bg-canvas shadow-e3">
            <iframe
              src={embed}
              title={`${service.name} video`}
              className="absolute inset-0 h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : video ? (
          <div className="relative aspect-video overflow-hidden rounded-3xl bg-canvas shadow-e3">
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
  );
}
