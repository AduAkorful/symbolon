// Service worker for push notices (plan 05zr 4a): shows the notice and opens the page it links to. No secrets, no fetching.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* an unreadable payload shows the generic text below */
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Symbolon";
  const body = typeof data.body === "string" ? data.body : "";
  // only a same-origin path is ever opened
  const href = typeof data.href === "string" && data.href.startsWith("/") && !data.href.startsWith("//") ? data.href : "/notifications";
  event.waitUntil(self.registration.showNotification(title, { body, data: { href }, tag: href }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/notifications";
  const url = new URL(href, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ("focus" in w) {
          w.navigate(url).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
