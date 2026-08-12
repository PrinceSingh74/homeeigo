import { useEffect } from "react";
import * as ScreenCapture from "expo-screen-capture";

/**
 * Blocks screenshots / screen recording while a sensitive screen (wallet, payment, OTP) is focused.
 * On Android this sets FLAG_SECURE; on iOS it obscures the screen in the app switcher / recordings.
 * Automatically re-allows capture on unmount so the rest of the app is unaffected.
 */
export function useScreenshotProtection(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void ScreenCapture.preventScreenCaptureAsync().catch(() => undefined);
    return () => {
      active = false;
      void ScreenCapture.allowScreenCaptureAsync().catch(() => undefined);
      void active;
    };
  }, [enabled]);
}
