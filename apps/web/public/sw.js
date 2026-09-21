const CACHE_VERSION = "anpr-pwa-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("anpr-pwa-") && name !== CACHE_VERSION).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Er is bewust geen fetch-handler: pagina's en /api/* gaan altijd rechtstreeks naar
// het netwerk en beveiligde sessie- of gebruikersantwoorden belanden niet in een cache.

self.addEventListener("push", (event) => {
  let message = { title: "ANPR Platform", body: "Er is een nieuwe melding.", data: { url: "/hits" } };
  try { if (event.data) message = { ...message, ...event.data.json() }; } catch { /* Toon veilige standaardtekst. */ }
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body,
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: message.data?.hitId ? `anpr-hit-${message.data.hitId}` : undefined,
    data: message.data,
    requireInteraction: true
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/hits", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  })());
});
