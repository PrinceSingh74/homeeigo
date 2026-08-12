import React, { useEffect } from "react";
import * as SplashScreen from "expo-splash-screen";
import { hideSplashOnce } from "@/lib/splash";
import { useAuthStore } from "@/stores/auth-store";
import { initDeviceId } from "@/lib/auth/device";
import { logApiBaseUrlOnce } from "@/lib/api-config";
import { RealtimeBridge } from "@/components/realtime/RealtimeBridge";
import { ActiveBookingChannel } from "@/components/realtime/ActiveBookingChannel";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useDeepLinking } from "@/hooks/use-deep-linking";
import { onHomeRender, startupMark } from "@/lib/startup-trace";
import { reportHydrationTimeout, reportInteractiveColdStart } from "@/lib/observability/startup-telemetry";

const HYDRATION_TIMEOUT_MS = 3000;
/** Splash must not wait for auth — hide once home paints or shortly after mount. */
const SPLASH_UI_READY_MS = 1500;

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  usePushNotifications();
  useDeepLinking();
  const bootstrap = useAuthStore((s) => s.bootstrap);

  const hideSplash = (reason: string): void => {
    hideSplashOnce(reason, reportInteractiveColdStart);
  };

  useEffect(() => {
    logApiBaseUrlOnce();
    void initDeviceId();
  }, []);

  // Splash follows UI readiness — NOT auth bootstrap (refresh can take 20s+ on bad LAN).
  useEffect(() => {
    const unsubHome = onHomeRender(() => hideSplash("home-render"));
    const uiReadyTimer = setTimeout(() => hideSplash("ui-ready-fallback"), SPLASH_UI_READY_MS);
    return () => {
      unsubHome();
      clearTimeout(uiReadyTimer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let bootstrapStarted = false;

    const runBootstrap = (): void => {
      if (bootstrapStarted || cancelled) return;
      bootstrapStarted = true;
      startupMark("HYDRATION", "bootstrap-scheduled");
      void bootstrap().catch(() => undefined);
    };

    if (useAuthStore.persist.hasHydrated()) {
      runBootstrap();
    } else {
      const unsubHydration = useAuthStore.persist.onFinishHydration(() => {
        if (!cancelled) runBootstrap();
      });

      // CRITICAL: never wait forever for AsyncStorage rehydration on device.
      const hydrationTimer = setTimeout(() => {
        if (!cancelled && !bootstrapStarted) {
          startupMark("HYDRATION", "timeout-forced");
          reportHydrationTimeout();
          runBootstrap();
        }
      }, HYDRATION_TIMEOUT_MS);

      return () => {
        cancelled = true;
        unsubHydration();
        clearTimeout(hydrationTimer);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [bootstrap]);

  return (
    <>
      {children}
      <RealtimeBridge />
      <ActiveBookingChannel />
    </>
  );
}
