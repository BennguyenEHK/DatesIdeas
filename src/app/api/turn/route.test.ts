import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";

const CF_RESPONSE = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    {
      urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
      username: "user-abc",
      credential: "cred-xyz",
    },
  ],
};

beforeEach(() => {
  process.env.CLOUDFLARE_TURN_KEY_ID = "key-1";
  process.env.CLOUDFLARE_TURN_API_TOKEN = "token-1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CLOUDFLARE_TURN_KEY_ID;
  delete process.env.CLOUDFLARE_TURN_API_TOKEN;
});

describe("GET /api/turn", () => {
  it("returns Cloudflare's ice servers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(CF_RESPONSE), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(CF_RESPONSE);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key-1/credentials/generate-ice-servers",
    );
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer token-1");
    expect(JSON.parse(init.body)).toEqual({ ttl: 7200 });
  });

  it("never leaks the api token in the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(CF_RESPONSE), { status: 201 })),
    );
    const body = await (await GET()).text();
    expect(body).not.toContain("token-1");
  });

  it("returns 503 with fallback stun when credentials are unconfigured", async () => {
    delete process.env.CLOUDFLARE_TURN_KEY_ID;
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.iceServers[0].urls).toContain("stun:stun.l.google.com:19302");
  });

  it("returns 502 with fallback stun when Cloudflare errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const res = await GET();
    expect(res.status).toBe(502);
    expect((await res.json()).iceServers.length).toBeGreaterThan(0);
  });
});
