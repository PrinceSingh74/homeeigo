// Defines the background-location TaskManager task at module scope. Must load before React renders
// so an OS-initiated (headless) start finds the task. See src/lib/background-location.ts.
import "@/lib/background-location";
import { LogBox, StyleSheet, View } from "react-native";
import { Stack, router } from "expo-router";
import { useEffect } from "react";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AppProviders } from "@/providers/AppProviders";
import { useAuthStore } from "@/stores/auth-store";
import { usePartnerPresenceHeartbeat } from "@/hooks/use-partner-presence-heartbeat";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { usePartnerRealtime } from "@/hooks/use-partner-realtime";
import { useBackgroundLocationController } from "@/hooks/use-background-location-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineBanner } from "@/components/home/OfflineBanner";
import { useConnectivityWatcher } from "@/hooks/account/use-connectivity";
import { color } from "@/theme/tokens";
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
  usePartnerPresenceHeartbeat();
  // `/ws/notifications`: pushes offers / transitions / wallet events into the query cache.
  usePartnerRealtime();
  // Background GPS while online or on an active job (only with "Always" permission).
  useBackgroundLocationController();
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

/** Reads every settled request to know whether the server can be reached (there is no NetInfo). */
function ConnectivityWatcher() {
  useConnectivityWatcher();
  return null;
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <ErrorBoundary>
        <AppProviders>
          <AuthBootstrap />
          <ConnectivityWatcher />
          {/* Dark icons on the paper background every screen sits on. */}
          <StatusBar style="dark" backgroundColor={color.paper} />
          <SafeAreaProvider style={styles.root}>
            <OfflineBanner />
            {/* Its own safe-area frame: under the offline banner a screen must not add the status-bar inset again. */}
            <SafeAreaProvider style={styles.root}>
              <View style={styles.root}>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }} />
              </View>
            </SafeAreaProvider>
          </SafeAreaProvider>
        </AppProviders>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
});
