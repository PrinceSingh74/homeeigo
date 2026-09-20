import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  CATEGORY_BY_ID,
  allServicePaths,
  serviceRedirects,
  buildCatalog,
  categoryHref,
  resolveServicesPath,
  type ResolvedPath,
} from "@/lib/catalog";
import { CategoryLanding, ServiceDetail } from "@/components/services-catalog/lazy-views";

export const revalidate = 60;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://homigo.app";

type Params = { path: string[] };

/**
 * Every canonical category, audience and service page is prerendered (ISR).
 * Unknown paths are a true 404 (dynamicParams = false): an on-demand render
 * would stream a 200 shell (the root loading.tsx Suspense boundary) before
 * notFound() could set the status. Legacy / cross-listed URLs never reach this
 * page — next.config.js redirects() answers them with a 308.
 */
export const dynamicParams = false;

export function generateStaticParams(): Params[] {
  // Taxonomy only — awaiting the live catalog here blocked the first visit to
  // every category/service URL while the RSC waited on the API.
  const catalog = buildCatalog(null);
  const redirects = new Set(serviceRedirects(catalog).map((r) => r.source));
  return allServicePaths(catalog)
    .filter((p) => !redirects.has(p))
    .map((p) => ({ path: p.replace(/^\/services\//, "").split("/") }));
}

/** Taxonomy-only — live prices hydrate on the client. A backend round-trip here
 *  blocked every category/service click for ~2s+ (RSC commit). */
function resolve(path: string[]): { resolved: ResolvedPath } {
  return { resolved: resolveServicesPath(buildCatalog(null), path) };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { path } = await params;
  const { resolved } = resolve(path);

  // Defensive: routing already 308s/404s these (next.config redirects, dynamicParams).
  if (resolved.kind === "redirect") permanentRedirect(resolved.to);
  if (resolved.kind === "not-found") notFound();

  if (resolved.kind === "category") {
    const c = resolved.category.def;
    return {
      title: `${c.name} Services at Home`,
      description: `${c.tagline} ${c.description}`,
      alternates: { canonical: categoryHref(c.id) },
    };
  }
  if (resolved.kind === "audience") {
    const name = resolved.audience.name;
    return {
      title: `Beauty & Grooming for ${name} at Home`,
      description: `Salon and grooming services for ${name.toLowerCase()} at your doorstep — ${resolved.audience.hint.toLowerCase()}.`,
      alternates: { canonical: `/services/beauty/${resolved.audience.id}` },
    };
  }
  if (resolved.kind === "service") {
    const s = resolved.service;
    const cat = CATEGORY_BY_ID.get(s.category)!;
    return {
      title: `${s.name} — ${cat.name}`,
      description: s.description,
      alternates: { canonical: s.href },
      // Live vs coming-soon is decided after the client catalog hydrates; blocking
      // the RSC on that fetch made every service URL feel stuck.
      openGraph: s.image?.startsWith("/") ? { images: [{ url: s.image }] } : undefined,
    };
  }
  return {};
}

export default async function ServicesPathRoute({ params }: { params: Promise<Params> }) {
  const { path } = await params;
  const { resolved } = resolve(path);

  switch (resolved.kind) {
    case "redirect":
      permanentRedirect(resolved.to);
    case "not-found":
      notFound();
    case "category":
      return (
        <>
          <JsonLd data={breadcrumbLd([["Services", "/services"], [resolved.category.def.name, categoryHref(resolved.category.def.id)]])} />
          <CategoryLanding initialServices={null} categoryId={resolved.category.def.id} />
        </>
      );
    case "audience":
      return (
        <>
          <JsonLd
            data={breadcrumbLd([
              ["Services", "/services"],
              ["Beauty & Grooming", categoryHref("beauty")],
              [resolved.audience.name, `/services/beauty/${resolved.audience.id}`],
            ])}
          />
          <CategoryLanding initialServices={null} categoryId="beauty" audience={resolved.audience.id} />
        </>
      );
    case "service": {
      const s = resolved.service;
      const cat = CATEGORY_BY_ID.get(s.category)!;
      return (
        <>
          <JsonLd
            data={{
              "@context": "https://schema.org",
              "@type": "Service",
              name: s.name,
              description: s.description,
              serviceType: cat.name,
              url: `${SITE_URL}${s.href}`,
              provider: { "@type": "Organization", name: "HOMEEIGO", url: SITE_URL },
              areaServed: "IN",
            }}
          />
          <JsonLd
            data={breadcrumbLd([
              ["Services", "/services"],
              [cat.name, categoryHref(cat.id)],
              [s.name, s.href],
            ])}
          />
          <ServiceDetail initialServices={null} slug={s.slug} detail={null} />
        </>
      );
    }
  }
}

function breadcrumbLd(items: [string, string][]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map(([name, href], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: `${SITE_URL}${href}`,
    })),
  };
}

function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // Values are our own catalogue strings; escape "<" so nothing can close the tag.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
