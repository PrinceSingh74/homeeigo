"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type NotificationPermissionState =
  | "default"
  | "granted"
  | "denied"
  | "unsupported";

type ShowNotificationOptions = {
  title: string;
  body?: string;
  tag?: string;
  url?: string;
  data?: Record<string, unknown>;
};

const SW_PATH = "/sw.js";

function currentPermission(): NotificationPermissionState {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission as NotificationPermissionState;
}

/**
 * Manages browser Notification permission + a service-worker registration so
 * the in-app realtime bridge can spawn native notifications.
 *
 * - Permission must be requested in response to a user gesture
 *   (`requestPermission`) for it to be granted on most browsers.
 * - `show` is safe to call from anywhere; if permission is not granted it
 *   silently no-ops.
 * - Service worker is registered lazily and only when permission is granted.
 */
export function useNativeNotifications() {
  const [permission, setPermission] = useState<NotificationPermissionState>(() =>
    currentPermission(),
  );
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const registeringRef = useRef<Promise<ServiceWorkerRegistration | null> | null>(null);

  const ensureRegistration = useCallback(async () => {
    if (typeof window === "undefined") return null;
    if (!("serviceWorker" in navigator)) return null;
    if (registrationRef.current) return registrationRef.current;
    if (registeringRef.current) return registeringRef.current;

    registeringRef.current = navigator.serviceWorker
      .register(SW_PATH, { scope: "/" })
      .then((registration) => {
        registrationRef.current = registration;
        return registration;
      })
      .catch(() => null);

    const result = await registeringRef.current;
    registeringRef.current = null;
    return result;
  }, []);

  useEffect(() => {
    if (currentPermission() === "granted") {
      void ensureRegistration();
    }
  }, [ensureRegistration]);

  const requestPermission = useCallback(async (): Promise<NotificationPermissionState> => {
    if (typeof window === "undefined") return "unsupported";
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return "unsupported";
    }
    if (Notification.permission === "granted") {
      setPermission("granted");
      void ensureRegistration();
      return "granted";
    }
    if (Notification.permission === "denied") {
      setPermission("denied");
      return "denied";
    }
    try {
      const result = (await Notification.requestPermission()) as NotificationPermissionState;
      setPermission(result);
      if (result === "granted") void ensureRegistration();
      return result;
    } catch {
      return Notification.permission as NotificationPermissionState;
    }
  }, [ensureRegistration]);

  const show = useCallback(
    async (options: ShowNotificationOptions) => {
      if (typeof window === "undefined") return false;
      if (!("Notification" in window)) return false;
      if (document.visibilityState === "visible") {
        // Don't spawn a native notification when the user is already viewing the tab;
        // in-app toasts will be enough.
        return false;
      }
      if (Notification.permission !== "granted") return false;

      const init: NotificationOptions = {
        body: options.body,
        tag: options.tag,
        icon: "/svc-cleaning.png",
        badge: "/svc-cleaning.png",
        data: { url: options.url ?? "/", ...(options.data ?? {}) },
      };

      try {
        const registration = await ensureRegistration();
        if (registration) {
          await registration.showNotification(options.title, init);
        } else {
          new Notification(options.title, init);
        }
        return true;
      } catch {
        return false;
      }
    },
    [ensureRegistration],
  );

  return {
    permission,
    isSupported: permission !== "unsupported",
    requestPermission,
    show,
  };
}
