import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  CATEGORY_BY_ID,
  allServicePaths,
  type CategoryId,
  serviceRedirects,
  buildCatalog,
  categoryHref,
  resolveServicesPath,
  type ResolvedPath,
} from "@/lib/catalog";
import { CategoryLanding, ServiceDetail } from "@/components/services-catalog/lazy-views";
import { fetchServiceDetail, fetchServicesCatalog } from "@/lib/server-api";
import { servicePageMeta } from "@/lib/catalog/service-meta";
import { detailContent } from "@/lib/catalog/content";
import type { ServiceView } from "@/lib/catalog/types";

/**
 * The taxonomy view merged with the live catalogue, or null when the catalogue
 * could not be read. An outage must not be treated as "this service is unpublished".
 */
async function publishedView(slug: string): Promise<ServiceView | null> {
  const data = await fetchServicesCatalog();
  if (!data) return null;
  return buildCatalog(data.services).bySlug.get(slug) ?? null;
}

export const revalidate = 60;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://homigo.app";

type Params = { path: string[] };

/**
 * Canonical category, audience and curated service pages are prerendered (ISR).
 * An admin-published SKU that is not in the static taxonomy (for example
 * /services/home-help/spa) is rendered on demand. Any other unknown path is a
 * true 404. Legacy / cross-listed URLs never reach this page — next.config.js
 * redirects() answers them with a 308.
 */
export const dynamicParams = true;

function publishedExtra(path: string[]): { category: CategoryId; slug: string } | null {
  const [rawCategory, rawSlug, ...rest] = path.map((s) => decodeURIComponent(s).toLowerCase());
  if (!rawCategory || !rawSlug || rest.length) return null;
  if (!CATEGORY_BY_ID.has(rawCategory as CategoryId)) return null;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(rawSlug)) return null;
  return { category: rawCategory as CategoryId, slug: rawSlug };
}

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
  if (resolved.kind === "not-found") {
    const extra = publishedExtra(path);
    if (!extra) notFound();
    const cat = CATEGORY_BY_ID.get(extra.category)!;
    const name = extra.slug.replace(/-/g, " ").replace(/(^|\s)([a-z])/g, (_, gap: string, ch: string) => gap + ch.toUpperCase());
    return {
      title: `${name} — ${cat.name}`,
      description: `${name} at home with ${cat.name}.`,
      alternates: { canonical: `/services/${extra.category}/${extra.slug}` },
    };
  }

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
    // Stored SEO fields live on the backend row. The taxonomy view has none of them.
    // Unknown catalogue (backend unreadable) does not noindex: an outage must not de-index live pages.
    const published = await publishedView(s.slug);
    const meta = servicePageMeta(published ?? s, cat.name);
    const index = published == null ? true : meta.index;
    return {
      title: meta.title,
      description: meta.description,
      alternates: { canonical: meta.canonical },
      ...(meta.keywords ? { keywords: meta.keywords } : {}),
      ...(!index ? { robots: { index: false, follow: true } } : {}),
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
    case "not-found": {
      const extra = publishedExtra(path);
      if (!extra) notFound();
      return <ServiceDetail initialServices={null} slug={extra.slug} detail={null} />;
    }
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
      const catalog = await fetchServicesCatalog();
      const published = catalog ? buildCatalog(catalog.services).bySlug.get(s.slug) ?? null : null;
      const source = published ?? s;
      const detail = source.backendId ? await fetchServiceDetail(source.backendId) : null;
      const content = detailContent(source, detail);
      return (
        <>
          <JsonLd
            data={{
              "@context": "https://schema.org",
              "@type": "Service",
              name: source.name,
              description: content.overview,
              serviceType: cat.name,
              url: `${SITE_URL}${source.href}`,
              provider: { "@type": "Organization", name: "HOMEEIGO", url: SITE_URL },
              areaServed: "IN",
              ...(content.rating
                ? { aggregateRating: { "@type": "AggregateRating", ratingValue: content.rating.value, reviewCount: content.rating.count, bestRating: 5, worstRating: 1 } }
                : {}),
            }}
          />
          {faqLd(content.faqs)}
          <JsonLd
            data={breadcrumbLd([
              ["Services", "/services"],
              [cat.name, categoryHref(cat.id)],
              [source.name, source.href],
            ])}
          />
          <ServiceDetail initialServices={catalog?.services ?? null} slug={s.slug} detail={detail} />
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

/** The same FAQ list the page renders. Nothing is added for the schema. */
function faqLd(faqs: { q: string; a: string }[]) {
  const real = faqs.filter((f) => f.q.trim() && f.a.trim());
  if (real.length === 0) return null;
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: real.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      }}
    />
  );
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
