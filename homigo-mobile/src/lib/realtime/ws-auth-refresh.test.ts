import { describe, expect, it } from "bun:test";
import { shouldRefreshAfterWsUnauthorized, tokenFromWsUrl } from "./ws-auth-refresh";

const WINDOW = 30_000;
const url = (token: string) => `ws://localhost:3100/ws/tracking/b1?token=${encodeURIComponent(token)}`;

describe("shouldRefreshAfterWsUnauthorized", () => {
  it("does not refresh when the refused socket carried an older token than the store holds", () => {
    // Device run: REST 401 → refresh at T; a frozen screen's socket still on the old token is
    // evicted by the server sweep at T+7 s. No WS-driven refresh happened yet, so only the token
    // comparison can stop the second rotation.
    expect(
      shouldRefreshAfterWsUnauthorized({ socketUrl: url("old.jwt"), currentAccessToken: "new.jwt", now: 100_000, lastWsAuthRefreshAt: 0, windowMs: WINDOW }),
    ).toBe(false);
  });

  it("refreshes when the socket's own (current) token expired", () => {
    expect(
      shouldRefreshAfterWsUnauthorized({ socketUrl: url("cur.jwt"), currentAccessToken: "cur.jwt", now: 100_000, lastWsAuthRefreshAt: 0, windowMs: WINDOW }),
    ).toBe(true);
  });

  it("still refreshes at most once per window for the current token", () => {
    expect(
      shouldRefreshAfterWsUnauthorized({ socketUrl: url("cur.jwt"), currentAccessToken: "cur.jwt", now: 100_000, lastWsAuthRefreshAt: 90_000, windowMs: WINDOW }),
    ).toBe(false);
  });

  it("falls back to the window when the URL carries no token or the store has none", () => {
    const base = { now: 100_000, lastWsAuthRefreshAt: 0, windowMs: WINDOW };
    expect(shouldRefreshAfterWsUnauthorized({ ...base, socketUrl: "ws://h/ws/notifications", currentAccessToken: "cur.jwt" })).toBe(true);
    expect(shouldRefreshAfterWsUnauthorized({ ...base, socketUrl: url("old.jwt"), currentAccessToken: null })).toBe(true);
    expect(shouldRefreshAfterWsUnauthorized({ ...base, socketUrl: null, currentAccessToken: "cur.jwt" })).toBe(true);
  });
});

describe("tokenFromWsUrl", () => {
  it("decodes the token query parameter wherever it sits", () => {
    expect(tokenFromWsUrl("ws://h/ws/booking/b1?token=a%2Bb.c")).toBe("a+b.c");
    expect(tokenFromWsUrl("ws://h/ws/booking/b1?x=1&token=abc&y=2")).toBe("abc");
    expect(tokenFromWsUrl("ws://h/ws/booking/b1?mytoken=abc")).toBeNull();
    expect(tokenFromWsUrl("ws://h/ws/booking/b1?token=")).toBeNull();
    expect(tokenFromWsUrl(null)).toBeNull();
  });
});
