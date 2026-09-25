import { describe, expect, test } from "bun:test";
import { offerRequiresLivePresence } from "../lib/scheduled-offer-presence";

describe("scheduled offer presence", () => {
  const now = new Date("2026-09-25T07:00:00.000Z");

  test("an appointment more than a day away does not need a live ping", () => {
    expect(offerRequiresLivePresence(new Date(now.getTime() + 23 * 60 * 60 * 1000), now)).toBe(true);
    expect(offerRequiresLivePresence(new Date(now.getTime() + 25 * 60 * 60 * 1000), now)).toBe(false);
  });
});
