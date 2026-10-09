/**
 * Listing clicks load the funnel client on demand. These tests use Bun's module mock so a
 * failed chunk can be simulated without a browser, and so a missing service id can be shown
 * not to evaluate that module.
 *
 * Run from apps/web: `bun test tests/analytics/service-click.test.ts`
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

type TrackCall = [
  name: string,
  payload: {
    serviceId: string;
    identity: string;
    metadata: {
      surface: string;
      slug: string | null;
      category: string | null;
      page: string | null;
      fromSearch: boolean | undefined;
    };
  },
];

const tracked: TrackCall[] = [];
let funnelEvaluations = 0;

mock.module("@/lib/analytics/funnel", () => {
  funnelEvaluations += 1;
  return {
    funnelDocumentInstance: () => "doc-1",
    trackFunnelEvent: (name: string, payload: TrackCall[1]) => {
      tracked.push([name, payload]);
      return "event-1";
    },
  };
});

const { trackServiceClick } = await import("@/lib/analytics/service-click");

function setPath(pathname: string): void {
  (globalThis as unknown as { window: { location: { pathname: string } } }).window = {
    location: { pathname },
  };
}

beforeEach(() => {
  tracked.length = 0;
  setPath("/services/beauty");
});

describe("trackServiceClick", () => {
  test("a click with a backend id loads the funnel client and sends the captured payload", async () => {
    trackServiceClick(
      { backendId: "svc_1", slug: "salon-at-home", category: "beauty" },
      "card",
      { query: "salon" },
    );
    setPath("/services/beauty/salon-at-home");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(funnelEvaluations).toBe(1);
    expect(tracked).toEqual([
      [
        "SERVICE_CLICK",
        {
          serviceId: "svc_1",
          identity: "card|doc-1",
          metadata: {
            surface: "card",
            slug: "salon-at-home",
            category: "beauty",
            page: "/services/beauty",
            fromSearch: true,
          },
        },
      ],
    ]);
  });

  test("a missing backend id does not load the funnel module", async () => {
    const before = funnelEvaluations;
    trackServiceClick({ backendId: null, slug: "soon", category: "beauty" }, "coming-soon");
    trackServiceClick({ slug: "soon" }, "card");
    trackServiceClick({ backendId: "" }, "search", { query: "x" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(funnelEvaluations).toBe(before);
    expect(tracked).toEqual([]);
  });
});
