/**
 * `/book?service=<id>` books the service the link names — or says it cannot. It used to fall back
 * to the first service of the catalogue whenever the id was not in the list it had loaded (a paused
 * service, a mistyped link, a catalogue longer than the list), and would then book that other
 * service under the customer's hand.
 *
 * Run from apps/web: `bun test tests/booking`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { urlServiceState } from "@/lib/book-selection";

const listed = [{ id: "s1", slug: "deep-cleaning" }, { id: "s2", slug: "laundry" }];

describe("urlServiceState", () => {
  test("no service in the link: nothing to resolve", () => {
    expect(urlServiceState({ urlId: null, listed, lookup: "idle" })).toBe("none");
  });

  test("a listed service is found by id or by slug", () => {
    expect(urlServiceState({ urlId: "s2", listed, lookup: "idle" })).toBe("listed");
    expect(urlServiceState({ urlId: "deep-cleaning", listed, lookup: "idle" })).toBe("listed");
  });

  test("a service not in the list is looked up; until the server answers nothing is assumed", () => {
    expect(urlServiceState({ urlId: "s9", listed, lookup: "loading" })).toBe("loading");
    expect(urlServiceState({ urlId: "s9", listed, lookup: "idle" })).toBe("loading");
  });

  test("the server's own answer decides: found, or not available", () => {
    expect(urlServiceState({ urlId: "s9", listed, lookup: "found" })).toBe("fetched");
    expect(urlServiceState({ urlId: "s9", listed, lookup: "failed" })).toBe("missing");
  });
});

describe("the page never substitutes another service for the one in the link", () => {
  const page = readFileSync(join(import.meta.dir, "..", "..", "src", "app", "book", "BookPageClient.tsx"), "utf8");

  test("it resolves the link through urlServiceState and says so when the service is not available", () => {
    expect(page.includes("urlServiceState(")).toBe(true);
    expect(page.includes('data-testid="book-service-unavailable"')).toBe(true);
  });

  test("a booking is not confirmed for a service the customer did not choose", () => {
    const start = page.indexOf("async function confirmBooking()");
    const guard = page.slice(start, start + 600);
    expect(guard.includes("urlService === \"missing\" && !pickedHere")).toBe(true);
  });
});
