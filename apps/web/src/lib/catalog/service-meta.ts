import type { ServiceView } from "@/lib/catalog/types";

/**
 * Public service metadata from the backend record when one exists.
 * The title and description never invent a price, a rating, or a trust claim:
 * they are the stored SEO fields, or the service's own name and description.
 * A version id is not part of the canonical path.
 */
export function servicePageMeta(service: Pick<ServiceView, "name" | "description" | "href" | "status" | "seoTitle" | "seoDescription" | "seoKeywords" | "indexable">, categoryName: string) {
  const title = service.seoTitle?.trim() || `${service.name} — ${categoryName}`;
  const description = service.seoDescription?.trim() || service.description;
  const keywords = (service.seoKeywords ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return {
    title,
    description,
    canonical: service.href,
    index: service.status === "live" && service.indexable !== false,
    keywords: keywords.length > 0 ? keywords : undefined,
  };
}
