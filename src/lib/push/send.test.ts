import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();
vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
  },
}));

const { sendToDevices, SNAP_PUSH_TTL_SEC, vapidConfig } = await import("./send");

const CONFIG = { publicKey: "pub", privateKey: "priv", subject: "mailto:a@b.test" };

const devices = [
  { id: "a", endpoint: "https://x.test/a", p256dh: "k", auth: "t" },
  { id: "b", endpoint: "https://x.test/b", p256dh: "k", auth: "t" },
];

const notification = {
  title: "A new snap",
  body: "Tap to see it on the reel.",
  image: "https://storage.test/photo.jpg",
  url: "/album",
  tag: "festibooth-snap",
};

function recorder() {
  const queries: string[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    void values;
    queries.push(strings.join("?").replace(/\s+/g, " ").trim());
    return Promise.resolve([]);
  };
  return { sql, queries };
}

beforeEach(() => {
  sendNotification.mockReset();
  sendNotification.mockResolvedValue(undefined);
  setVapidDetails.mockReset();
});

describe("vapidConfig", () => {
  it("is absent rather than throwing when push is not set up", () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "");
    expect(vapidConfig()).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("sendToDevices", () => {
  it("pushes to every device", async () => {
    const { sql } = recorder();
    const outcome = await sendToDevices(sql, devices, notification, CONFIG);
    expect(outcome.sent).toBe(2);
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it("carries the picture, which is the whole point of the notification", async () => {
    const { sql } = recorder();
    await sendToDevices(sql, [devices[0]], notification, CONFIG);
    const payload = JSON.parse(String(sendNotification.mock.calls[0][1]));
    expect(payload.image).toBe("https://storage.test/photo.jpg");
    expect(payload.url).toBe("/album");
  });

  it("lets the push expire rather than delivering yesterday's afternoon", async () => {
    const { sql } = recorder();
    await sendToDevices(sql, [devices[0]], notification, CONFIG);
    expect(sendNotification.mock.calls[0][2]).toMatchObject({ TTL: SNAP_PUSH_TTL_SEC });
  });

  it("does nothing at all when push is not configured", async () => {
    const { sql } = recorder();
    const outcome = await sendToDevices(sql, devices, notification, null);
    expect(outcome).toEqual({ sent: 0, retired: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("retires a channel the service says is gone", async () => {
    const { sql, queries } = recorder();
    sendNotification.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    const outcome = await sendToDevices(sql, [devices[0]], notification, CONFIG);
    expect(outcome.retired).toBe(1);
    expect(queries.some((query) => query.includes("UPDATE pair_devices SET failed_at"))).toBe(true);
  });

  it("keeps a device whose phone is merely off", async () => {
    // A timeout or a 500 is temporary. Retiring on those would cost somebody
    // their notifications for going on holiday, with nothing to explain it.
    const { sql, queries } = recorder();
    sendNotification.mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 500 }));
    const outcome = await sendToDevices(sql, [devices[0]], notification, CONFIG);
    expect(outcome.retired).toBe(0);
    expect(outcome.sent).toBe(0);
    expect(queries).toHaveLength(0);
  });

  it("never throws, because the photograph is already saved by the time it runs", async () => {
    const { sql } = recorder();
    sendNotification.mockRejectedValue(new Error("network is on fire"));
    await expect(sendToDevices(sql, devices, notification, CONFIG)).resolves.toEqual({
      sent: 0,
      retired: 0,
    });
  });

  it("one dead device does not stop the other being told", async () => {
    const { sql } = recorder();
    sendNotification
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 404 }))
      .mockResolvedValueOnce(undefined);
    const outcome = await sendToDevices(sql, devices, notification, CONFIG);
    expect(outcome).toEqual({ sent: 1, retired: 1 });
  });
});
