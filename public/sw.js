/*
 * FestiBooth's service worker.
 *
 * It does exactly three jobs and deliberately no caching. An offline shell
 * would be a fourth job with its own staleness problems, and the album is
 * signed-URL content that cannot usefully be cached anyway.
 *
 *   1. Catch a photo shared from the Android share sheet, which arrives as a
 *      POST that no page can read.
 *   2. Show a push.
 *   3. Put the right page in front of somebody who taps one.
 */

const SHARE_CACHE = "festibooth-shared-v1";
const SHARE_PREFIX = "/__shared__/";

self.addEventListener("install", () => {
  // Take over immediately. Waiting for every tab to close means a fix ships
  // whenever somebody happens to reboot, which for a two-person app is never.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/*
 * The share target.
 *
 * Android POSTs the files here as multipart form data. A page cannot read its
 * own POST body, so the worker takes them, parks them in the Cache API, and
 * redirects to a page that knows to come looking.
 *
 * They are parked rather than uploaded here on purpose: the upload needs the
 * season ticket cookie and the presign dance, and a video can run to hundreds
 * of megabytes -- work that belongs on a page that can show progress and say
 * what went wrong, not in a worker with nowhere to report to.
 */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.pathname !== "/share") return;

  event.respondWith(
    (async () => {
      try {
        const form = await event.request.formData();
        const files = form.getAll("files").filter((f) => f && typeof f === "object" && "type" in f);
        const cache = await caches.open(SHARE_CACHE);

        const index = [];
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          const key = `${SHARE_PREFIX}${Date.now()}-${i}`;
          await cache.put(
            new Request(key),
            new Response(file, { headers: { "Content-Type": file.type || "application/octet-stream" } }),
          );
          index.push({
            key,
            name: file.name || `shared-${i}`,
            type: file.type || "",
            // The phone's own timestamp for the photograph. This is the whole
            // reason a shared photo lands on the day it was taken rather than
            // the day it was shared.
            lastModified: typeof file.lastModified === "number" ? file.lastModified : Date.now(),
          });
        }

        await cache.put(
          new Request(`${SHARE_PREFIX}index`),
          new Response(JSON.stringify(index), { headers: { "Content-Type": "application/json" } }),
        );

        return Response.redirect("/album?shared=1", 303);
      } catch {
        // Losing the share is bad; leaving the person staring at a dead tab is
        // worse. Send them to the album, where they can add it by hand.
        return Response.redirect("/album?shared=failed", 303);
      }
    })(),
  );
});

/*
 * A snap arriving.
 *
 * The payload carries an image URL, and Android renders it as a big picture in
 * the shade -- which is the point of the whole feature: you see their face
 * without opening anything.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = typeof data.title === "string" ? data.title : "FestiBooth";
  const options = {
    body: typeof data.body === "string" ? data.body : "Something new on the reel.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Collapses with any earlier unread snap rather than stacking five up.
    tag: typeof data.tag === "string" ? data.tag : "festibooth-snap",
    renotify: true,
    data: { url: typeof data.url === "string" ? data.url : "/album" },
  };
  if (typeof data.image === "string" && data.image !== "") options.image = data.image;

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/album";

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse a tab that is already open rather than opening a third copy of
      // the album next to the two already there.
      for (const client of all) {
        if (new URL(client.url).pathname.startsWith("/album") && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
