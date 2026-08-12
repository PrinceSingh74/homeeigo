/**
 * Bounded telemetry dimensions for Real-User Monitoring. Every value is from a SMALL fixed set so
 * Prometheus label cardinality stays controlled (device × network × route stays in the low hundreds).
 */

export type DeviceClass = "desktop" | "android" | "iphone" | "ipad" | "tablet" | "other";
export type NetworkClass = "4g" | "3g" | "2g" | "slow-2g" | "offline" | "unknown";

/** Coarse device class from UA / UA-CH (no fingerprinting — just the form factor bucket). */
export function deviceClass(): DeviceClass {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/\biPad\b/.test(ua) || (/\bMacintosh\b/.test(ua) && (navigator.maxTouchPoints || 0) > 1)) return "ipad";
  if (/\biPhone\b/.test(ua)) return "iphone";
  if (/\bAndroid\b/.test(ua)) return /\bMobile\b/.test(ua) ? "android" : "tablet";
  if (/\bTablet\b/.test(ua)) return "tablet";
  if (/\bMobi\b/.test(ua)) return "other";
  return "desktop";
}

/** Effective network class from the Network Information API (4g covers WiFi/5G high-bandwidth). */
export function networkClass(): NetworkClass {
  if (typeof navigator === "undefined") return "unknown";
  if (navigator.onLine === false) return "offline";
  const c = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  const et = c?.effectiveType;
  if (et === "4g" || et === "3g" || et === "2g" || et === "slow-2g") return et;
  return "unknown";
}

/** Whitelisted route bucket (full pathname → known segment) to bound per-route cardinality. */
const ROUTE_SET = new Set([
  "/", "/services", "/bookings", "/wallet", "/profile", "/membership", "/book", "/ai",
  "/providers", "/notifications", "/settings", "/support", "/referrals", "/login", "/signup",
  "/verify-otp",
]);
export function routeBucket(pathname: string): string {
  if (!pathname) return "other";
  if (ROUTE_SET.has(pathname)) return pathname;
  // collapse dynamic segments, then re-check
  const collapsed = "/" + pathname.split("/").filter(Boolean)[0];
  return ROUTE_SET.has(collapsed) ? collapsed : "other";
}

/** Full bounded RUM context for a beacon. */
export function rumContext(pathname?: string) {
  return {
    device: deviceClass(),
    network: networkClass(),
    route: routeBucket(pathname ?? (typeof location !== "undefined" ? location.pathname : "")),
  };
}
