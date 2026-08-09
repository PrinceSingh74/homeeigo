import Constants from "expo-constants";
import { Platform } from "react-native";

const DEFAULT_API_PORT = "3000";

function isLoopbackBase(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(url);
}

function isPrivateLanBase(url: string): boolean {
  return /^https?:\/\/(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);
}

function extractExpoDevHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(":")[0];
    if (host && !isLoopbackBase(`http://${host}`)) return host;
  }
  const debuggerHost = Constants.expoGoConfig?.debuggerHost;
  if (debuggerHost) {
    const host = debuggerHost.split(":")[0];
    if (host && !isLoopbackBase(`http://${host}`)) return host;
  }
  return null;
}

function resolveDevApiBase(configured: string): string {
  if (!__DEV__ || Platform.OS === "web") return configured;
  if (!isLoopbackBase(configured) && !isPrivateLanBase(configured)) return configured;
  const port = configured.match(/:(\d+)(?:\/|$)/)?.[1] ?? DEFAULT_API_PORT;
  const expoHost = extractExpoDevHost();
  if (expoHost) return `http://${expoHost}:${port}`;
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
    if (!productionUrl) throw new Error("EXPO_PUBLIC_API_URL must be set for production builds.");
    return productionUrl.replace(/\/$/, "");
  }
  const configured = (fromEnv ?? fromExtra ?? `http://localhost:${DEFAULT_API_PORT}`).replace(/\/$/, "");
  return resolveDevApiBase(configured);
}
