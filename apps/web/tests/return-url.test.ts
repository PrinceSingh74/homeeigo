import { describe, expect, test } from "bun:test";
import { sanitizeOAuthReturnUrl } from "../src/lib/auth/google-oauth";

describe("sign-in return path", () => {
  test("keeps an in-app booking path and drops external targets", () => {
    expect(sanitizeOAuthReturnUrl("/book?service=abc")).toBe("/book?service=abc");
    expect(sanitizeOAuthReturnUrl("https://evil.example/phish")).toBe("/");
    expect(sanitizeOAuthReturnUrl("//evil.example")).toBe("/");
    expect(sanitizeOAuthReturnUrl("/login")).toBe("/");
    expect(sanitizeOAuthReturnUrl(null)).toBe("/");
  });
});
