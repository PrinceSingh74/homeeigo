import type { MetadataRoute } from "next";
import { AUDIENCES, CATEGORIES, buildCatalog, categoryHref } from "@/lib/catalog";
import { fetchServicesCatalog } from "@/lib/server-api";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://homigo.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const route = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] = "weekly",
  ) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });

  // Bookable service pages only — coming-soon pages are noindex until they launch.
  const catalog = buildCatalog((await fetchServicesCatalog())?.services);
  const catalogRoutes = [
    ...CATEGORIES.map((c) => route(categoryHref(c.id), 0.8, "daily")),
    ...AUDIENCES.map((a) => route(`/services/beauty/${a.id}`, 0.6, "weekly")),
    ...catalog.services.filter((s) => s.status === "live" && s.indexable !== false).map((s) => route(s.href, 0.7, "daily")),
  ];

  return [
    route("/", 1, "daily"),
    route("/services", 0.9, "daily"),
    ...catalogRoutes,
    route("/providers", 0.8, "daily"),
    route("/support", 0.7, "monthly"),
    route("/login", 0.5, "yearly"),
    route("/signup", 0.6, "yearly"),
    route("/legal", 0.4, "yearly"),
    route("/legal/privacy", 0.3, "yearly"),
    route("/legal/terms", 0.3, "yearly"),
    route("/legal/cookies", 0.3, "yearly"),
    route("/legal/refund", 0.3, "yearly"),
  ];
}
