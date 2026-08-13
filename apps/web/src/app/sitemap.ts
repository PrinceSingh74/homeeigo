import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://homigo.app";

export default function sitemap(): MetadataRoute.Sitemap {
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

  return [
    route("/", 1, "daily"),
    route("/services", 0.9, "daily"),
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
