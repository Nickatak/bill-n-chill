/**
 * Bill n Chill — Service Worker
 *
 * No fetch caching — all requests go straight to the network.
 * The SW exists solely for push notifications and future live-update
 * messaging via postMessage.
 */

// ---------------------------------------------------------------------------
// Install — activate immediately, no pre-caching
// ---------------------------------------------------------------------------

self.addEventListener("install", () => {
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate — purge any caches left over from previous SW versions
// ---------------------------------------------------------------------------

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// ---------------------------------------------------------------------------
// Push — display notification from backend
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Bill n Chill", body: event.data.text() };
  }

  const options = {
    body: data.body || "",
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
    data: { url: data.url || "/" },
  };

  event.waitUntil(
    Promise.all([
      // Show background notification
      self.registration.showNotification(data.title || "Bill n Chill", options),
      // Post message to any open tabs for live data updates
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "PUSH_RECEIVED", payload: data });
        }
      }),
    ])
  );
});

// ---------------------------------------------------------------------------
// Notification click — open the relevant route
// ---------------------------------------------------------------------------

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus existing window if one is open
      for (const client of clients) {
        if (new URL(client.url).pathname === targetUrl && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a new one
      return self.clients.openWindow(targetUrl);
    })
  );
});
