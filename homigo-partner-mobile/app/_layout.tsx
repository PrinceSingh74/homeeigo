import { LogBox } from "react-native";
import { Stack, router } from "expo-router";
import { useEffect } from "react";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppProviders } from "@/providers/AppProviders";
import { useAuthStore } from "@/stores/auth-store";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { initSentry, setSentryUser } from "@/lib/observability/sentry";

// Initialised before any component mounts so a crash during the first render is still captured.
// No-ops entirely when EXPO_PUBLIC_SENTRY_DSN is unset.
initSentry();

if (__DEV__ && process.env.EXPO_PUBLIC_E2E_NATIVE === "1") {
  LogBox.ignoreAllLogs();
}

function inviteHrefFromUrl(url: string): string | null {
  const parsed = Linking.parse(url);
  const path = `${parsed.hostname ?? ""}${parsed.path ?? ""}`.replace(/^\/+/, "");
  if (path !== "register" && !path.startsWith("register/")) return null;
  const invite = parsed.queryParams?.invite;
  const token = Array.isArray(invite) ? invite[0] : invite;
  return token ? `/register?invite=${encodeURIComponent(String(token))}` : "/register";
}

function AuthBootstrap() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const user = useAuthStore((s) => s.user);
  // Registers/refreshes the Expo push token once authenticated and routes notification taps.
  // No-ops safely in Expo Go and when permission is declined.
  usePushNotifications();
  useEffect(() => {
    const run = () => {
      void bootstrap();
    };
    const unsub = useAuthStore.persist.onFinishHydration(run);
    if (useAuthStore.persist.hasHydrated()) run();
    return () => {
      unsub();
    };
  }, [bootstrap]);
  // Attach only the partner id/role to crash reports — never name, phone, or any other PII.
  useEffect(() => {
    setSentryUser(user ? { id: user.id, role: user.role } : null);
  }, [user]);
  useEffect(() => {
    function openInvite(url: string) {
      const href = inviteHrefFromUrl(url);
      if (href) router.push(href as "/register");
    }
    const sub = Linking.addEventListener("url", (event) => openInvite(event.url));
    void Linking.getInitialURL().then((url) => {
      if (url) openInvite(url);
    });
    return () => sub.remove();
  }, []);
  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <AppProviders>
          <AuthBootstrap />
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </AppProviders>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
