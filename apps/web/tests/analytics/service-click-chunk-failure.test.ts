/**
 * A failed analytics chunk must reject the import without becoming an unhandled rejection,
 * and the caller must be free to navigate immediately. Separate from the success file so
 * this mock is the one that evaluates `@/lib/analytics/funnel`.
 *
 * Run from apps/web: `bun test tests/analytics/service-click-chunk-failure.test.ts`
 */
import { describe, expect, mock, test } from "bun:test";

mock.module("@/lib/analytics/funnel", () => {
  throw new Error("chunk load failed");
});

const { trackServiceClick } = await import("@/lib/analytics/service-click");

describe("trackServiceClick when the funnel chunk fails", () => {
  test("the failure is handled and the caller continues at once", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onRejection);
    try {
      let navigated = false;
      const returned = trackServiceClick(
        { backendId: "svc_1", slug: "salon-at-home", category: "beauty" },
        "card",
      );
      navigated = true;
      expect(returned).toBeUndefined();
      expect(navigated).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});
