import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: string[] = [];
let results: unknown[][] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
    void values;
    queries.push(strings.join("?").replace(/\s+/g, " ").trim());
    return Promise.resolve(results.shift() ?? []);
  },
}));

const { GET, POST, DELETE } = await import("./route");

const TICKET = "abcdefghijklmnopqrstuv";
const pairRow = [{ id: "00000000-0000-0000-0000-000000000000", created_at: new Date() }];
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

function body(payload: unknown, method: "POST" | "DELETE", authorized = true) {
  return new Request("http://x/api/push", {
    method,
    headers: {
      "content-type": "application/json",
      ...(authorized ? { authorization: `Bearer ${TICKET}` } : {}),
    },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  queries.length = 0;
  results = [];
  vi.unstubAllEnvs();
});

describe("GET /api/push", () => {
  it("reports plainly when this deployment has no keys", async () => {
    // Silence here would ship a browser that subscribes to nothing and a
    // button that appears to work.
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    vi.stubEnv("VAPID_SUBJECT", "");
    const body = await (await GET()).json();
    expect(body).toEqual({ available: false, publicKey: null });
  });

  it("hands out the public key, which is not a secret", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    vi.stubEnv("VAPID_SUBJECT", "mailto:a@b.test");
    const body = await (await GET()).json();
    expect(body).toEqual({ available: true, publicKey: "pub" });
  });

  it("never hands out the private one", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "the-private-key");
    vi.stubEnv("VAPID_SUBJECT", "mailto:a@b.test");
    const text = JSON.stringify(await (await GET()).json());
    expect(text).not.toContain("the-private-key");
  });
});

describe("POST /api/push", () => {
  it("refuses a caller holding no ticket, without asking the database", async () => {
    const response = await POST(body({ endpoint: ENDPOINT, p256dh: "k", auth: "a" }, "POST", false));
    expect(response.status).toBe(401);
    expect(queries).toHaveLength(0);
  });

  it("records the subscription and names the device back", async () => {
    results = [pairRow, [{ id: "device-1" }]];
    const response = await POST(body({ endpoint: ENDPOINT, p256dh: "k", auth: "a" }, "POST"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deviceId: "device-1" });
  });

  it("refuses an endpoint that is not an https URL", async () => {
    // Whatever is stored here is later POSTed to by the server.
    results = [pairRow];
    for (const endpoint of ["http://x.test/a", "file:///etc/passwd", "nonsense"]) {
      results = [pairRow];
      const response = await POST(body({ endpoint, p256dh: "k", auth: "a" }, "POST"));
      expect(response.status).toBe(400);
    }
  });

  it("refuses a subscription with no keying material", async () => {
    // Without both keys the push cannot be encrypted, and an unencrypted one
    // is refused outright by every push service.
    results = [pairRow];
    expect((await POST(body({ endpoint: ENDPOINT, p256dh: "", auth: "a" }, "POST"))).status).toBe(400);
    results = [pairRow];
    expect((await POST(body({ endpoint: ENDPOINT, p256dh: "k" }, "POST"))).status).toBe(400);
  });
});

describe("DELETE /api/push", () => {
  it("refuses a caller holding no ticket", async () => {
    const response = await DELETE(body({ endpoint: ENDPOINT }, "DELETE", false));
    expect(response.status).toBe(401);
    expect(queries).toHaveLength(0);
  });

  it("scopes the removal to the caller's own pair", async () => {
    results = [pairRow, [{ id: "device-1" }]];
    const response = await DELETE(body({ endpoint: ENDPOINT }, "DELETE"));
    expect(response.status).toBe(200);
    expect(queries.some((query) => /DELETE FROM pair_devices/i.test(query) && /pair_id =/i.test(query))).toBe(true);
  });

  it("reports not found rather than succeeding on somebody else's device", async () => {
    results = [pairRow, []];
    expect((await DELETE(body({ endpoint: ENDPOINT }, "DELETE"))).status).toBe(404);
  });
});
