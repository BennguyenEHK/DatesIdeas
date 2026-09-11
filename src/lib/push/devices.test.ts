import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { devicesToNotify, forgetDevice, isPushEndpoint, rememberDevice } from "./devices";

const PAIR = "11111111-1111-1111-1111-111111111111";

function recorder(results: unknown[][] = []) {
  const queries: string[] = [];
  const bindings: unknown[][] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(strings.join("?").replace(/\s+/g, " ").trim());
    bindings.push(values);
    return Promise.resolve(results.shift() ?? []);
  };
  return { sql, queries, bindings };
}

describe("isPushEndpoint", () => {
  it("accepts the real push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc123",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
      "https://wns2-by3p.notify.windows.com/w/?token=xyz",
    ]) {
      expect(isPushEndpoint(endpoint)).toBe(true);
    }
  });

  it("refuses anything that is not an https URL", () => {
    // The server later POSTs to whatever is stored here. A server that will
    // POST to any string a client hands it is a request-forgery gadget, so
    // this is the one place that has to be picky.
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "not a url",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(isPushEndpoint(endpoint)).toBe(false);
    }
  });

  it("refuses credentials smuggled into the authority", () => {
    expect(isPushEndpoint("https://user:pass@fcm.googleapis.com/fcm/send/a")).toBe(false);
  });

  it("refuses one long enough to be a payload rather than an endpoint", () => {
    expect(isPushEndpoint(`https://example.test/${"a".repeat(2100)}`)).toBe(false);
  });
});

describe("rememberDevice", () => {
  it("moves an existing endpoint to the new pair rather than failing", async () => {
    // A browser re-subscribes on its own schedule and hands back the same
    // endpoint. Inserting blindly would fail; ignoring the conflict would
    // leave a phone pointed at an album it has since left.
    const { sql, queries } = recorder([[{ id: "device-1" }]]);
    const id = await rememberDevice(sql, PAIR, {
      endpoint: "https://fcm.googleapis.com/fcm/send/a",
      p256dh: "key",
      auth: "auth",
    });
    expect(id).toBe("device-1");
    expect(queries[0]).toMatch(/ON CONFLICT \(endpoint\) DO UPDATE/i);
    expect(queries[0]).toMatch(/pair_id = excluded\.pair_id/i);
  });

  it("clears a previous failure, because the device has just proved it is alive", async () => {
    const { sql, queries } = recorder([[{ id: "device-1" }]]);
    await rememberDevice(sql, PAIR, {
      endpoint: "https://fcm.googleapis.com/fcm/send/a",
      p256dh: "key",
      auth: "auth",
    });
    expect(queries[0]).toMatch(/failed_at = NULL/i);
  });
});

describe("devicesToNotify", () => {
  it("leaves out the device that caused the push", async () => {
    // Otherwise the phone you just took the photograph on buzzes in your hand
    // to tell you that you took a photograph.
    const { sql, bindings } = recorder([[]]);
    await devicesToNotify(sql, PAIR, "device-1");
    expect(bindings[0]).toContain("device-1");
  });

  it("skips devices the push service has already refused", async () => {
    const { sql, queries } = recorder([[]]);
    await devicesToNotify(sql, PAIR, null);
    expect(queries[0]).toMatch(/failed_at IS NULL/i);
  });

  it("drops a row that does not have what a push needs", async () => {
    // Encryption needs both keys. A row missing one cannot be pushed to, and
    // returning it would only produce a failure further away from the cause.
    const { sql } = recorder([
      [
        { id: "a", endpoint: "https://x.test/a", p256dh: "k", auth: "t" },
        { id: "b", endpoint: "https://x.test/b", p256dh: "k" },
      ],
    ]);
    const devices = await devicesToNotify(sql, PAIR, null);
    expect(devices.map((device) => device.id)).toEqual(["a"]);
  });
});

describe("forgetDevice", () => {
  it("is scoped by pair, so an endpoint alone cannot unsubscribe somebody else", async () => {
    const { sql, queries } = recorder([[{ id: "device-1" }]]);
    const gone = await forgetDevice(sql, PAIR, "https://fcm.googleapis.com/fcm/send/a");
    expect(gone).toBe(true);
    expect(queries[0]).toMatch(/pair_id =/i);
  });

  it("reports nothing removed when it was not theirs", async () => {
    const { sql } = recorder([[]]);
    expect(await forgetDevice(sql, PAIR, "https://fcm.googleapis.com/fcm/send/a")).toBe(false);
  });
});
