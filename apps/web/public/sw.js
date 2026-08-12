/* HOMIGO service worker — minimal install for native push notifications.
 *  Kept intentionally small to avoid interfering with Next.js caching.
 *  Browser push (FCM/Web-Push) requires a registered VAPID key on the backend
 *  before push events fire; until then this SW only serves notification clicks
 *  initiated by the in-app `useNativeNotifications` hook.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "HOMIGO", message: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "HOMIGO";
  const body = payload.message || payload.body || "";
  const tag = payload.tag || payload.id || undefined;
  const data = {
    url: payload.url || payload.referenceUrl || "/",
    referenceId: payload.referenceId || null,
    type: payload.type || null,
  };
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: "/svc-cleaning.png",
      badge: "/svc-cleaning.png",
      data,
      renotify: !!tag,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) {
            try {
              client.navigate(target);
            } catch {
              /* ignore navigation errors */
            }
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(target);
      }
    }),
  );
});
