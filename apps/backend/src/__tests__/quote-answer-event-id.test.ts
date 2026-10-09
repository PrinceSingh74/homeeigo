import { describe, expect, test } from "bun:test";
import { quoteAnswerEventId } from "../services/analytics-funnel.service";

const EVENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

describe("quote answer event id", () => {
  test("two answers that share a token stay two ids, and one nonce stays one id", () => {
    const token = "same-signed-token.for-this-second";
    const a = quoteAnswerEventId(token, "nonceaaa1");
    const b = quoteAnswerEventId(token, "noncebbb2");
    const again = quoteAnswerEventId(token, "nonceaaa1");
    expect(a).not.toBe(b);
    expect(a).toBe(again);
    expect(a.slice(0, 34)).toBe(b.slice(0, 34));
    expect(a).toMatch(EVENT_ID_RE);
    expect(b).toMatch(EVENT_ID_RE);
  });

  test("a fresh call does not reuse the previous id", () => {
    const token = "another-token";
    expect(quoteAnswerEventId(token)).not.toBe(quoteAnswerEventId(token));
  });
});
