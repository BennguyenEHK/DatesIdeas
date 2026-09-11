"use client";

import { useEffect } from "react";

/**
 * Registers the service worker, and nothing else.
 *
 * Its own component so the root layout stays a server component. The worker is
 * what makes the app installable, what catches a photo from the Android share
 * sheet, and what shows a push -- none of which can happen without this one
 * call having been made at least once on the device.
 *
 * Registration failing is not worth reporting. A browser with no service
 * worker support, or a private window that refuses one, still runs every part
 * of the app that matters; it simply cannot be installed or pushed to.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // After load, so registering never competes with the first paint for
    // bandwidth on a phone that is already waiting for two video streams.
    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
