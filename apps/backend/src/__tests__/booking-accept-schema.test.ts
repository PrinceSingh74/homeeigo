import { describe, expect, test } from "bun:test";
import { bookingAcceptSchema } from "../schemas/provider.schema";
import { optionalGeoPingSchema } from "../schemas/booking.schema";
import { tryValidate } from "../middleware/validation.middleware";

describe("bookingAcceptSchema — Accept body must not toast Expected number", () => {
  test("omitted eta is valid", () => {
    const result = tryValidate(bookingAcceptSchema, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.eta).toBeUndefined();
  });

  test("null eta is valid (JSON.stringify of unset eta)", () => {
    const result = tryValidate(bookingAcceptSchema, { eta: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.eta).toBeNull();
  });

  test("positive integer eta is kept", () => {
    const result = tryValidate(bookingAcceptSchema, { eta: 18 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.eta).toBe(18);
  });

  test("null body coalesced to {} is valid (accept route uses raw ?? {})", () => {
    // Typed as the route sees it: an unknown body that may be null. Writing `null ?? {}` inline
    // made the coalesce a compile-time constant (TS2871), so the test proved nothing about the
    // route's actual `body ?? {}`.
    const rawBody: Record<string, unknown> | null = null;
    const result = tryValidate(bookingAcceptSchema, rawBody ?? {});
    expect(result.success).toBe(true);
  });
});

describe("optionalGeoPingSchema — On my way / complete allow missing GPS", () => {
  test("null coordinates are valid", () => {
    const result = tryValidate(optionalGeoPingSchema, { latitude: null, longitude: null });
    expect(result.success).toBe(true);
  });

  test("omitted coordinates are valid", () => {
    const result = tryValidate(optionalGeoPingSchema, {});
    expect(result.success).toBe(true);
  });

  test("real coordinates are kept", () => {
    const result = tryValidate(optionalGeoPingSchema, { latitude: 28.527, longitude: 77.219 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.latitude).toBe(28.527);
      expect(result.data.longitude).toBe(77.219);
    }
  });
});
