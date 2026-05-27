import { Elysia } from "elysia";

/** Part 11 — transport security response headers */
export const securityHeadersPlugin = new Elysia({ name: "security-headers" }).onAfterHandle(({ set }) => {
  set.headers["X-Frame-Options"] = "DENY";
  set.headers["X-Content-Type-Options"] = "nosniff";
  set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
  set.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";
  if (process.env.NODE_ENV === "production") {
    set.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
});
