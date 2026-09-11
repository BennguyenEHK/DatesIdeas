"use client";

/**
 * Turning notifications on, from the browser's side.
 *
 * Three separate things have to be true before a push can arrive, and they
 * fail in different ways: the browser must support push at all, the person
 * must grant permission, and the server must have VAPID keys. Each is reported
 * separately here because the remedy for each is different -- and "enable
 * notifications" silently doing nothing is the worst outcome available.
 */

const DEVICE_KEY = "festibooth.device";

export type PushState =
  | "unsupported"
  | "unconfigured"
  | "denied"
  | "granted"
  | "off";

/**
 * base64url to raw bytes, which is what applicationServerKey wants.
 *
 * Returns the ArrayBuffer rather than a view of one. A Uint8Array is a legal
 * BufferSource at runtime but not in the types here, because a typed array may
 * be backed by a SharedArrayBuffer and this API will not take one.
 */
function decodeKey(base64Url: string): ArrayBuffer {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let index = 0; index < raw.length; index += 1) view[index] = raw.charCodeAt(index);
  return buffer;
}

function keyToBase64(buffer: ArrayBuffer | null): string | null {
  if (buffer === null) return null;
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function supportsPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** What this browser's situation is, without asking for anything. */
export async function pushState(): Promise<PushState> {
  if (!supportsPush()) return "unsupported";
  if (Notification.permission === "denied") return "denied";

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing !== null && Notification.permission === "granted") return "granted";
  return "off";
}

/**
 * Asks permission, subscribes, and tells the server where to push.
 *
 * Resolves to the resulting state rather than throwing, because every failure
 * here is something to show on a button rather than an exception: a refused
 * prompt is a decision, not an error.
 */
export async function enablePush(): Promise<PushState> {
  if (!supportsPush()) return "unsupported";

  const config = await fetch("/api/push", { credentials: "same-origin" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const publicKey: unknown = config?.publicKey;
  if (typeof publicKey !== "string" || publicKey === "") return "unconfigured";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  try {
    const registration = await navigator.serviceWorker.ready;
    // Reuse an existing subscription rather than making a second one. A browser
    // hands back the same endpoint anyway, and subscribing twice only differs
    // in how many ways it can fail.
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        // Required, and required to be true: a push that does not show a
        // notification is silent data collection, and Chrome refuses it.
        userVisibleOnly: true,
        applicationServerKey: decodeKey(publicKey),
      }));

    const p256dh = keyToBase64(subscription.getKey("p256dh"));
    const auth = keyToBase64(subscription.getKey("auth"));
    if (p256dh === null || auth === null) return "off";

    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ endpoint: subscription.endpoint, p256dh, auth }),
    });
    if (!response.ok) return "off";

    const body = (await response.json()) as { deviceId?: unknown };
    if (typeof body.deviceId === "string") {
      try {
        localStorage.setItem(DEVICE_KEY, body.deviceId);
      } catch {
        // Only costs this device a buzz about its own snaps.
      }
    }
    return "granted";
  } catch {
    return "off";
  }
}

/** Turning them off again, on this device only. */
export async function disablePush(): Promise<PushState> {
  if (!supportsPush()) return "unsupported";
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription !== null) {
      await fetch("/api/push", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => {});
      await subscription.unsubscribe().catch(() => {});
    }
    try {
      localStorage.removeItem(DEVICE_KEY);
    } catch {
      /* nothing worth interrupting for */
    }
    return "off";
  } catch {
    return "off";
  }
}
