import { describe, expect, test } from "bun:test";

/**
 * Navigation-induced aborts must not be treated as failures (ChunkLoadRecovery used to reload in
 * answer to them, cancelling the user's own navigation). The flag must also clear itself when a
 * beforeunload does not end in an unload, so a page that stays keeps real recovery.
 */
describe("page-lifecycle", () => {
  test("beforeunload / pagehide mark the page as leaving; pageshow and the timeout clear it", async () => {
    const listeners = new Map<string, Array<() => void>>();
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: (type: string, fn: () => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    };
    const { isPageLeaving } = await import(`../src/lib/page-lifecycle.ts?t=${Date.now()}`);
    const fire = (type: string) => listeners.get(type)?.forEach((fn) => fn());

    expect(isPageLeaving()).toBe(false);
    fire("beforeunload");
    expect(isPageLeaving()).toBe(true);
    fire("pageshow");
    expect(isPageLeaving()).toBe(false);
    fire("pagehide");
    expect(isPageLeaving()).toBe(true);
    // A beforeunload that does not end in an unload (download, mailto:) must not stick.
    await new Promise((r) => setTimeout(r, 3_100));
    expect(isPageLeaving()).toBe(false);
    delete (globalThis as { window?: unknown }).window;
  }, 10_000);
});
