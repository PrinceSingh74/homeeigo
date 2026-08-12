import "../global.css";
import React from "react";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { enableFreeze } from "react-native-screens";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { hideSplashOnce } from "@/lib/splash";
import { useTheme } from "@/hooks/useTheme";
import { AppToast } from "@/components/AppToast";
import { AppOverlays } from "@/components/app/AppOverlays";
import { AppProviders } from "@/providers/AppProviders";
import { ErrorBoundary } from "@/components/app/ErrorBoundary";
import { OfflineBanner } from "@/components/app/OfflineBanner";
import { startConnectivityService } from "@/lib/connectivity/connectivity-service";
import { markAppStart } from "@/lib/observability/telemetry";
import { scheduleOfflineSync } from "@/lib/offline/sender";
import { startTelemetryQueueService } from "@/lib/observability/telemetry-queue";
import { installStartupErrorHooks } from "@/lib/startup-guards";
import { startupMark, onInteractive } from "@/lib/startup-trace";
import { initSentry } from "@/lib/observability/sentry";

markAppStart();
// Suspends React trees for screens pushed off-screen (stack + tabs). Without it a
// screen you navigated away from keeps re-rendering on every query update while its
// Reanimated loops keep driving the UI thread.
enableFreeze(true);
// Initialise Sentry at module load (earliest point) so render-time crashes are captured and the
// __HOMIGO_SENTRY__ bridge used by ErrorBoundary/reportError is wired before any component mounts.
initSentry();

export default function RootLayout() {
  const { colors: themeColors, isDark } = useTheme();

  React.useEffect(() => {
    startupMark("APP_START");
    startupMark("NAVIGATION_READY");
    installStartupErrorHooks();
    startConnectivityService();
    startTelemetryQueueService();
    // Defer offline replay until UI is interactive — avoids competing with bootstrap refresh.
    const unsubOffline = onInteractive(() => scheduleOfflineSync());

    // Failsafe: never leave the native splash visible if UI/bootstrap stalls.
    // hideSplashOnce is a no-op once AuthProvider's home-render path already ran.
    const splashFailsafe = setTimeout(() => hideSplashOnce("root-failsafe"), 3000);

    return () => {
      clearTimeout(splashFailsafe);
      unsubOffline();
    };
  }, []);

  return (
    <ErrorBoundary>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProviders>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: themeColors.bg },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="book"
              options={{
                animation: "slide_from_right",
                presentation: "card",
              }}
            />
            <Stack.Screen
              name="login"
              options={{
                animation: "fade",
                presentation: "modal",
              }}
            />
            <Stack.Screen name="track/[bookingId]" options={{ animation: "slide_from_bottom", presentation: "card" }} />
            <Stack.Screen name="support/index" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="invoices" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="address/picker" options={{ animation: "slide_from_bottom", presentation: "modal" }} />
            <Stack.Screen name="signup" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="verify-otp" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="forgot-password" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="reset-password" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="legal/privacy" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="legal/terms" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="legal/refund" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="legal/cookies" options={{ animation: "slide_from_right" }} />
          </Stack>
          <AppToast />
          <AppOverlays />
          <OfflineBanner />
          <StatusBar style={isDark ? "light" : "dark"} />
        </AppProviders>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
