import * as Linking from "expo-linking";

const AUTH_ROUTES = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-otp",
  "/auth/google/callback",
  "/auth/apple/callback",
] as const;

export function isAuthRoute(path: string): boolean {
  const base = path.split("?")[0] ?? path;
  return AUTH_ROUTES.some((r) => base === r || base.endsWith(r));
}

export function sanitizeOAuthReturnUrl(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return "/(tabs)";
  if (url.startsWith("/(tabs)") || url.startsWith("/book")) return url;
  if (url.startsWith("/") && !url.startsWith("//") && !isAuthRoute(url)) return url;
  return "/(tabs)";
}

export function buildLoginUrl(returnUrl?: string): string {
  const target = returnUrl ? encodeURIComponent(returnUrl) : "";
  return target ? `/login?returnUrl=${target}` : "/login";
}

export function getGoogleOAuthRedirectUri(): string {
  return (
    process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI ??
    Linking.createURL("auth/google/callback")
  );
}

export function getAppleOAuthRedirectUri(): string {
  return (
    process.env.EXPO_PUBLIC_APPLE_REDIRECT_URI ??
    Linking.createURL("auth/apple/callback")
  );
}
