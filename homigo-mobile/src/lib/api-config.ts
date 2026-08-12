import Constants from "expo-constants";
import { Platform } from "react-native";

const DEFAULT_API_PORT = "3000";

function isLoopbackBase(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(url);
}

/**
 * Private-LAN addresses (10.x, 192.168.x, 172.16-31.x, 169.254.x) identify the dev
 * machine on a local network. These are reassigned by DHCP, so a value hard-coded in
 * .env goes stale whenever the machine's IP changes — we treat them as "auto-detectable"
 * and prefer the live Metro host instead. Public domains/IPs (e.g. staging) are respected.
 */
function isPrivateLanBase(url: string): boolean {
  return /^https?:\/\/(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);
}

/** Metro / Expo Go advertises the dev machine LAN IP via hostUri (e.g. 10.191.60.32:8081). */
function extractExpoDevHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(":")[0];
    if (host && !isLoopbackBase(`http://${host}`)) return host;
  }

  const linkingMatch = Constants.linkingUri?.match(/^exp:\/\/([^:/]+)/);
  const linkingHost = linkingMatch?.[1];
  if (linkingHost && !isLoopbackBase(`http://${linkingHost}`)) return linkingHost;

  const debuggerHost = Constants.expoGoConfig?.debuggerHost;
  if (debuggerHost) {
    const host = debuggerHost.split(":")[0];
    if (host && !isLoopbackBase(`http://${host}`)) return host;
  }

  return null;
}

/**
 * True when Metro is reached over loopback on a device — i.e. the app was opened
 * through a USB `adb reverse` tunnel. In that setup the device's own localhost is
 * forwarded to this machine, so `localhost:<apiPort>` is the correct API base
 * (and is immune to the dev machine's Wi-Fi IP changing).
 */
function hasLoopbackMetroHost(): boolean {
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri && isLoopbackBase(`http://${hostUri.split(":")[0]}`)) return true;
  const debuggerHost = Constants.expoGoConfig?.debuggerHost;
  if (debuggerHost && isLoopbackBase(`http://${debuggerHost.split(":")[0]}`)) return true;
  return false;
}

/**
 * `EXPO_PUBLIC_DEV_API_MODE=usb` pins the API to the device's own localhost, which
 * `adb reverse tcp:<port> tcp:<port>` forwards to this machine. Use it when the phone
 * is wired over USB: it needs no Wi-Fi at all and never goes stale when the dev
 * machine's IP changes. Anything else keeps the automatic LAN detection below.
 */
function isUsbTunnelMode(): boolean {
  return (process.env.EXPO_PUBLIC_DEV_API_MODE ?? "").trim().toLowerCase() === "usb";
}

function resolveDevApiBase(configured: string): string {
  // Production, web, or an explicit public/remote host: use exactly what's configured.
  if (!__DEV__ || Platform.OS === "web") return configured;

  const configuredPort = configured.match(/:(\d+)(?:\/|$)/)?.[1] ?? DEFAULT_API_PORT;
  if (isUsbTunnelMode()) return `http://localhost:${configuredPort}`;

  if (!isLoopbackBase(configured) && !isPrivateLanBase(configured)) return configured;

  const port = configuredPort;

  // On a physical device / Expo Go, Metro advertises the dev machine's CURRENT LAN IP.
  // Prefer it over a loopback or a (possibly stale) private-LAN value from .env so the
  // app always follows the machine the phone is actually connected to — no manual IP edits.
  const expoHost = extractExpoDevHost();
  if (expoHost) {
    return `http://${expoHost}:${port}`;
  }

  // USB (`adb reverse`): Metro came over loopback, so the device's localhost is
  // already forwarded to this machine — use it regardless of what .env holds.
  if (hasLoopbackMetroHost()) {
    return `http://localhost:${port}`;
  }

  // No Metro host (tunnel/standalone). A loopback base can't reach the host from a
  // device, so fall back to the Android emulator alias; otherwise keep what we have.
  if (isLoopbackBase(configured) && Platform.OS === "android") {
    return `http://10.0.2.2:${port}`;
  }

  return configured;
}

export function getApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL?.trim();
  const fromExtra = (Constants.expoConfig?.extra?.apiUrl as string | undefined)?.trim();

  if (!__DEV__) {
    const productionUrl = fromEnv ?? fromExtra;
    if (!productionUrl) {
      throw new Error(
        "EXPO_PUBLIC_API_URL must be set for production builds (no localhost fallback).",
      );
    }
    if (isLoopbackBase(productionUrl)) {
      throw new Error(
        `Production API URL cannot be loopback (${productionUrl}). Set EXPO_PUBLIC_API_URL to your Cloud Run / API domain.`,
      );
    }
    return productionUrl.replace(/\/$/, "");
  }

  const configured = (fromEnv ?? fromExtra ?? `http://localhost:${DEFAULT_API_PORT}`).replace(
    /\/$/,
    "",
  );
  return resolveDevApiBase(configured);
}

export function toWsBase(httpBase: string): string {
  return httpBase.replace(/^http/i, "ws").replace(/\/$/, "");
}

/** Dev-only: log resolved API base once at startup. */
export function logApiBaseUrlOnce(): void {
  if (!__DEV__) return;
  const g = globalThis as typeof globalThis & { __homigoApiLogged?: boolean };
  if (g.__homigoApiLogged) return;
  g.__homigoApiLogged = true;
  const configured = process.env.EXPO_PUBLIC_API_URL ?? "(unset — using localhost default)";
  console.info(
    `[Homeeigo API] configured=${configured} resolved=${getApiBaseUrl()} platform=${Platform.OS}`,
  );
}
