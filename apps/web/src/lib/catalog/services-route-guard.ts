/**
 * Decides, BEFORE rendering, whether a /services/... URL can exist — so a nonexistent one gets a real
 * HTTP 404 instead of a 200 with a not-found body.
 *
 * WHY THIS LIVES IN MIDDLEWARE
 * The app has loading.tsx boundaries from the root down. Any page that calls notFound() while
 * rendering has already streamed the loading shell with status 200 — /services/nope and
 * /services/a/b/c/d answered 200 to users AND crawlers (a soft 404). dynamicParams=false avoided it
 * until admin-published services (commit a9a7f10) had to render on demand. Middleware runs before any
 * byte is streamed, so the status it chooses is the status the client gets.
 *
 * The rules mirror resolveServicesPath (adapter.ts) + publishedExtra (the [...path] page). Legacy and
 * cross-listed URLs never reach here: next.config redirects() answers them with a 308 first.
 */
import { AUDIENCES, CATEGORY_BY_ID, SERVICE_DEFS } from "./taxonomy";

export type ServicesRouteVerdict =
  /** a page (hub, category, audience, curated service) — render it */
  | "ok"
  /** cannot exist — 404 */
  | "not-found"
  /** a well-formed slug outside the static taxonomy — exists only if the backend publishes it */
  | { check: "published"; slug: string };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TAXONOMY_SLUGS = new Set<string>(SERVICE_DEFS.flatMap((d) => [d.slug, ...(d.bind ?? [])]));
const AUDIENCE_IDS = new Set<string>(AUDIENCES.map((a) => a.id));

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment).toLowerCase();
  } catch {
    return null; // malformed percent-encoding
  }
}

/** `pathname` is the request path, e.g. "/services/home-cleaning/bathroom-cleaning". */
export function servicesRouteVerdict(pathname: string): ServicesRouteVerdict {
  const raw = pathname.replace(/\/+$/, "").split("/").slice(2); // drop "" and "services"
  if (raw.length === 0) return "ok"; // hub
  const segments = raw.map(decode);
  if (segments.some((s) => s == null || s === "")) return "not-found";
  const [category, slug, leaf, ...rest] = segments as string[];

  if (rest.length > 0) return "not-found";
  if (!CATEGORY_BY_ID.has(category as never)) return "not-found";
  if (slug == null) return "ok"; // category landing

  if (category === "beauty" && AUDIENCE_IDS.has(slug)) {
    // /services/beauty/<audience> is a page; <audience>/<leaf> legacy URLs were 308'd by next.config.
    return leaf == null ? "ok" : "not-found";
  }
  if (leaf != null) return "not-found";
  if (TAXONOMY_SLUGS.has(slug)) return "ok"; // curated service (or a redirect the page issues)
  if (!SLUG.test(slug)) return "not-found";
  return { check: "published", slug };
}

/* ------------------------------------------------------------------------------------------------
 * Published slugs (admin-published services outside the static taxonomy)
 *
 * Read from the same public list the catalogue uses, cached for a minute. When the backend cannot be
 * read the answer is "unknown" and the page renders as before: an outage must never 404 a real page.
 * ---------------------------------------------------------------------------------------------- */

const TTL_MS = 60_000;
let cached: { at: number; slugs: Set<string> } | null = null;
let inflight: Promise<Set<string> | null> | null = null;

async function loadPublishedSlugs(apiBase: string): Promise<Set<string> | null> {
  const load = async (page: number) => {
    const res = await fetch(`${apiBase}/api/services?limit=100&page=${page}`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) throw new Error(`services ${res.status}`);
    const json = (await res.json()) as { success?: boolean; data?: { services?: { slug?: string | null }[]; total?: number; limit?: number } };
    if (!json.success || !json.data?.services) throw new Error("services response");
    return json.data;
  };
  try {
    const first = await load(1);
    const limit = first.limit && first.limit > 0 ? first.limit : 100;
    const pages = Math.min(20, Math.max(1, Math.ceil((first.total ?? first.services!.length) / limit)));
    const rest = pages > 1 ? await Promise.all(Array.from({ length: pages - 1 }, (_, i) => load(i + 2))) : [];
    const slugs = new Set<string>();
    for (const p of [first, ...rest]) for (const s of p.services ?? []) if (s.slug) slugs.add(s.slug.toLowerCase());
    return slugs;
  } catch {
    return null;
  }
}

/** true / false when known; null when the backend could not be read (caller must fail open). */
export async function isPublishedServiceSlug(slug: string, apiBase: string): Promise<boolean | null> {
  const now = Date.now();
  // A miss on a cache older than 10 s re-reads, so a service published a moment ago is not 404'd.
  const stale = !cached || now - cached.at > TTL_MS || (!cached.slugs.has(slug) && now - cached.at > 10_000);
  if (stale) {
    inflight ??= loadPublishedSlugs(apiBase).finally(() => {
      inflight = null;
    });
    const slugs = await inflight;
    if (slugs) cached = { at: Date.now(), slugs };
  }
  const current = cached;
  return current ? current.slugs.has(slug) : null;
}
