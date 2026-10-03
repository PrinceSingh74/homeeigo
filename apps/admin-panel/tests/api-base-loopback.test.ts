import { describe, expect, test } from "bun:test";
import { alignLoopbackApiOrigin } from "../src/lib/api-base";

describe("alignLoopbackApiOrigin", () => {
  test("rewrites 127.0.0.1 to the page host so the refresh cookie stays same-site", () => {
    expect(alignLoopbackApiOrigin("http://127.0.0.1:3000", "localhost")).toBe("http://localhost:3000");
  });

  test("rewrites localhost to 127.0.0.1 when the page is opened that way", () => {
    expect(alignLoopbackApiOrigin("http://localhost:3000/", "127.0.0.1")).toBe("http://127.0.0.1:3000");
  });

  test("leaves a matching loopback host unchanged", () => {
    expect(alignLoopbackApiOrigin("http://localhost:3000", "localhost")).toBe("http://localhost:3000");
  });

  test("does not rewrite a production origin", () => {
    expect(alignLoopbackApiOrigin("https://api.homigo.com", "localhost")).toBe("https://api.homigo.com");
    expect(alignLoopbackApiOrigin("http://127.0.0.1:3000", "app.homigo.com")).toBe("http://127.0.0.1:3000");
  });
});