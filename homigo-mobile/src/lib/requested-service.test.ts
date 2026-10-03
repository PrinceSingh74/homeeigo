import { describe, expect, it } from "bun:test";
import { findServiceIndex, isServiceId, withRequestedService } from "./requested-service";

const page = [
  { id: "cmuc7noky017ctzg8tk5oibw1", name: "Sofa Deep Cleaning" },
  { id: "cmubisxmw001wtzv41xgvyay3", name: "Bathroom Cleaning" },
  { id: "cmuk5ief51ykvtz0o9sxd698c", name: "AC Service" },
];

describe("findServiceIndex", () => {
  it("finds a service by exact id, id fragment, or name fragment", () => {
    expect(findServiceIndex(page, "cmuk5ief51ykvtz0o9sxd698c")).toBe(2);
    expect(findServiceIndex(page, "cmubisxmw")).toBe(1);
    expect(findServiceIndex(page, "ac service")).toBe(2);
    expect(findServiceIndex(page, "cleaning")).toBe(0);
  });

  it("prefers an exact id over an earlier fragment match", () => {
    const tricky = [{ id: "cmuk5ief51ykvtz0o9sxd698c-old", name: "Legacy" }, ...page];
    expect(findServiceIndex(tricky, "cmuk5ief51ykvtz0o9sxd698c")).toBe(3);
  });

  it("returns -1 — never the first service — when the request is not in the loaded page", () => {
    expect(findServiceIndex(page, "cmuk6zkn7001wtz1ghsj663f2")).toBe(-1);
    expect(findServiceIndex(page, "")).toBe(-1);
    expect(findServiceIndex([], "cleaning")).toBe(-1);
  });
});

describe("isServiceId", () => {
  it("accepts catalogue cuids and refuses slugs and names", () => {
    expect(isServiceId("cmuk6zkn7001wtz1ghsj663f2")).toBe(true);
    expect(isServiceId("cleaning")).toBe(false);
    expect(isServiceId("c123")).toBe(false);
    expect(isServiceId("../admin")).toBe(false);
  });
});

describe("withRequestedService", () => {
  it("puts a separately fetched service in front of the page", () => {
    const extra = { id: "cmuk6zkn7001wtz1ghsj663f2", name: "Adv Service" };
    const merged = withRequestedService(page, extra);
    expect(merged[0]).toBe(extra);
    expect(merged).toHaveLength(4);
    expect(findServiceIndex(merged, extra.id)).toBe(0);
  });

  it("never duplicates a service already in the page, and leaves the page alone without one", () => {
    expect(withRequestedService(page, page[1])).toBe(page);
    expect(withRequestedService(page, null)).toBe(page);
  });
});
