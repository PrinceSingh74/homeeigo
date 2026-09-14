import { describe, expect, test } from "bun:test";
import {
  applyMustIncludeProximityBypass,
  canBypassMustIncludeBlock,
  canonicalDispatchEmail,
  mergeMustIncludeFront,
  mustIncludePhonesForEmail,
  parseDispatchMustInclude,
} from "../lib/dispatch-must-include";

describe("dispatch must-include pins", () => {
  test("canonicalizes gamil/gmial typos to gmail", () => {
    expect(canonicalDispatchEmail("PrinceSingh40343@Gamil.com")).toBe("princesingh40343@gmail.com");
    expect(canonicalDispatchEmail("  princesingh40343@gmial.com ")).toBe("princesingh40343@gmail.com");
  });

  test("default pin maps Prince Singh emails to Rahul Sharma's phone", () => {
    const pins = parseDispatchMustInclude(undefined);
    expect(mustIncludePhonesForEmail("princesingh40343@gmail.com", pins)).toEqual(["+919876543211"]);
    expect(mustIncludePhonesForEmail("princesingh40343@gamil.com", pins)).toEqual(["+919876543211"]);
    expect(mustIncludePhonesForEmail("other@homigo.demo", pins)).toEqual([]);
  });

  test("env JSON overrides default pins", () => {
    const pins = parseDispatchMustInclude('{"a@x.com":["9876543210"]}');
    expect(mustIncludePhonesForEmail("a@x.com", pins)).toEqual(["+919876543210"]);
    expect(mustIncludePhonesForEmail("princesingh40343@gmail.com", pins)).toEqual([]);
  });

  test("pinned partner is first and not duplicated", () => {
    const merged = mergeMustIncludeFront(
      [
        { providerId: "near-1" },
        { providerId: "rahul" },
        { providerId: "near-2" },
      ],
      [{ providerId: "rahul" }],
    );
    expect(merged.map((p) => p.providerId)).toEqual(["rahul", "near-1", "near-2"]);
  });

  test("offline/radius blocks are bypassable; lifecycle is not", () => {
    expect(canBypassMustIncludeBlock("OFFLINE")).toBe(true);
    expect(canBypassMustIncludeBlock("OUTSIDE_SERVICE_AREA")).toBe(true);
    expect(canBypassMustIncludeBlock("LOCATION_INVALID")).toBe(true);
    expect(canBypassMustIncludeBlock("LOCATION_REQUIRED")).toBe(true);
    expect(canBypassMustIncludeBlock("STALE_PRESENCE")).toBe(true);
    expect(canBypassMustIncludeBlock("ACCOUNT_RESTRICTED")).toBe(false);
    expect(canBypassMustIncludeBlock("APPROVAL_PENDING")).toBe(false);
  });

  test("pinned arrive/start substitutes job coords when GPS is missing", () => {
    const job = { jobLatitude: 28.61, jobLongitude: 77.2 };
    const bypassed = applyMustIncludeProximityBypass({
      ok: false,
      error: "LOCATION_INVALID",
      pinned: true,
      latitude: 0,
      longitude: 0,
      ...job,
    });
    expect(bypassed).toEqual({ ok: true, latitude: 28.61, longitude: 77.2 });

    const blocked = applyMustIncludeProximityBypass({
      ok: false,
      error: "LOCATION_INVALID",
      pinned: false,
      latitude: 0,
      longitude: 0,
      ...job,
    });
    expect(blocked).toEqual({ ok: false, error: "LOCATION_INVALID" });
  });
});
