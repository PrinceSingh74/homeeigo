import { getDeviceId } from "@/lib/auth/device";

const FP_KEY = "homigo_browser_fp";

function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (h * 33) ^ input.charCodeAt(i);
  return `bf-${(h >>> 0).toString(16)}`;
}

function collectBrowserTraits(): string {
  if (typeof window === "undefined") return "";
  const nav = navigator;
  const scr = window.screen;
  return [
    nav.userAgent,
    nav.language,
    nav.platform,
    scr?.width,
    scr?.height,
    scr?.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    nav.hardwareConcurrency,
  ].join("|");
}

export function getBrowserFingerprint(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const cached = sessionStorage.getItem(FP_KEY);
    if (cached) return cached;
    const fp = hashString(collectBrowserTraits());
    sessionStorage.setItem(FP_KEY, fp);
    return fp;
  } catch {
    return hashString(collectBrowserTraits());
  }
}

export function getTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** HTTP headers attached to every API call for server-side fraud intelligence. */
export function getFraudHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const deviceId = getDeviceId();
  if (deviceId) headers["x-device-id"] = deviceId;
  const tz = getTimezone();
  if (tz) headers["x-timezone"] = tz;
  const fp = getBrowserFingerprint();
  if (fp) headers["x-browser-fingerprint"] = fp;
  return headers;
}

/** JSON body fields for signup / OAuth callbacks (headers are also sent). */
export function getFraudBodyFields(): {
  browserFingerprint?: string;
  timezone?: string;
} {
  return {
    browserFingerprint: getBrowserFingerprint(),
    timezone: getTimezone(),
  };
}
