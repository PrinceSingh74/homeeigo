import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { AUDIENCES, CATEGORIES, SERVICE_DEFS } from "../../src/lib/catalog/taxonomy";
import { isPublishedServiceSlug, servicesRouteVerdict } from "../../src/lib/catalog/services-route-guard";

/**
 * /services/* answered 200 for URLs that cannot exist (a loading.tsx shell streams before notFound()),
 * so middleware now decides first. These pin the verdicts; the HTTP status itself is checked against a
 * running server by the services-catalog E2E (26–27) and the route matrix.
 */
describe("servicesRouteVerdict", () => {
  test("every canonical page is ok", () => {
    for (const c of CATEGORIES) expect(servicesRouteVerdict(`/services/${c.id}`)).toBe("ok");
    for (const a of AUDIENCES) expect(servicesRouteVerdict(`/services/beauty/${a.id}`)).toBe("ok");
    for (const d of SERVICE_DEFS) expect(servicesRouteVerdict(`/services/${d.category}/${d.slug}`)).toBe("ok");
    expect(servicesRouteVerdict("/services/")).toBe("ok");
  });

  test("structurally impossible paths are 404 without asking the backend", () => {
    for (const p of [
      "/services/nope",
      "/services/a/b/c/d",
      "/services/home-cleaning/bathroom-cleaning/extra",
      "/services/beauty/women/anything",
      "/services/home-cleaning/Bad_Slug",
      "/services/home-cleaning/-x",
      "/services/home-cleaning/%E0%A4",
      "/services/home-cleaning/%2e%2e",
    ]) {
      expect(servicesRouteVerdict(p)).toBe("not-found");
    }
  });

  test("a well-formed unknown slug in a real category is a backend question", () => {
    expect(servicesRouteVerdict("/services/home-help/spa")).toEqual({ check: "published", slug: "spa" });
    expect(servicesRouteVerdict("/services/HOME-HELP/Spa")).toEqual({ check: "published", slug: "spa" });
  });
});

describe("isPublishedServiceSlug", () => {
  afterEach(() => {
    (globalThis.fetch as unknown as { mockRestore?: () => void }).mockRestore?.();
  });

  const listing = (slugs: string[]) =>
    new Response(JSON.stringify({ success: true, data: { services: slugs.map((slug) => ({ slug })), total: slugs.length, limit: 100 } }), {
      headers: { "content-type": "application/json" },
    });

  test("published → true, unpublished → false (one listing read, then cached)", async () => {
    const f = spyOn(globalThis, "fetch").mockImplementation(async () => listing(["spa", "bathroom-cleaning"]));
    expect(await isPublishedServiceSlug("spa", "http://api.guard-test-1")).toBe(true);
    const calls = f.mock.calls.length;
    expect(await isPublishedServiceSlug("spa", "http://api.guard-test-1")).toBe(true);
    expect(f.mock.calls.length).toBe(calls);
    expect(await isPublishedServiceSlug("not-a-service-zz", "http://api.guard-test-1")).toBe(false);
  });

  test("backend unreadable with nothing cached → null (the caller fails open; an outage never 404s a real page)", async () => {
    // Fresh module instance: the cache above must not answer for this case.
    const fresh = await import(`../../src/lib/catalog/services-route-guard.ts?unreadable=${Date.now()}`);
    spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await fresh.isPublishedServiceSlug("spa", "http://api.guard-test-2")).toBeNull();
  });
});
