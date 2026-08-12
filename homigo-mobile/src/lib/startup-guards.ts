import * as SplashScreen from "expo-splash-screen";
import { reportError } from "@/lib/observability/telemetry";

const g = globalThis as typeof globalThis & { __homigoStartupHooks?: boolean };

/** Race a promise against a timeout; returns fallback on expiry (never hangs startup). */
export async function withStartupTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Surface fatal errors and unhandled rejections; always hide splash on crash. */
export function installStartupErrorHooks(): void {
  if (g.__homigoStartupHooks) return;
  g.__homigoStartupHooks = true;

  type GlobalWithErrorUtils = typeof globalThis & {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    };
  };

  const ErrorUtils = (globalThis as GlobalWithErrorUtils).ErrorUtils;
  const previous = ErrorUtils?.getGlobalHandler?.();
  ErrorUtils?.setGlobalHandler?.((error: unknown, isFatal?: boolean) => {
    reportError(error, { phase: "startup-fatal", isFatal: !!isFatal });
    void SplashScreen.hideAsync().catch(() => undefined);
    previous?.(error, isFatal);
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracking = require("promise/setimmediate/rejection-tracking") as {
      enable: (opts: {
        allRejections: boolean;
        onUnhandled: (id: number, error: unknown) => void;
        onHandled?: (id: number) => void;
      }) => void;
    };
    tracking.enable({
      allRejections: true,
      onUnhandled: (_id, error) => {
        reportError(error, { phase: "unhandled-rejection" });
        void SplashScreen.hideAsync().catch(() => undefined);
      },
    });
  } catch {
    /* rejection-tracking unavailable on some targets */
  }

  // Belt-and-suspenders for Hermes / web targets where rejection-tracking is absent.
  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
      reportError(event.reason, { phase: "unhandledrejection-event" });
      void SplashScreen.hideAsync().catch(() => undefined);
    });
  }
}
