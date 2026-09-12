import { beforeEach, describe, expect, it, vi } from "vitest";

const queries: string[] = [];
let results: unknown[][] = [];
type Signed = { uploadUrl: string; downloadUrl: string; key: string } | null;
// Typed to include the null the real presignKeepsake can return, so a test can
// make signing fail without the mock's inferred type refusing it.
const presign = vi.fn<(key: string) => Promise<Signed>>(async (key: string) => ({
  uploadUrl: `put:${key}`,
  downloadUrl: `get:${key}`,
  key,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => (strings: TemplateStringsArray, ...values: unknown[]) => {
  void values; queries.push(strings.join("?").replace(/\s+/g, " ")); return Promise.resolve(results.shift() ?? []);
} }));
vi.mock("@/lib/storage/objects", () => ({ presignKeepsake: presign }));
vi.mock("@/lib/push/devices", () => ({ devicesToNotify: async () => [] }));
vi.mock("@/lib/push/send", () => ({ sendToDevices: async () => undefined, SNAP_PUSH_TTL_SEC: 60 }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  // The push after a confirm runs once the response is sent; there is no
  // request lifecycle here to run it in, and nothing in these tests needs it.
  after: () => undefined,
}));
const { POST, PUT, GET } = await import("./route");
const { receiptMatches, uploadReceipt } = await import("@/lib/album/receipt");

const SECRET = "test-storage-secret";

const ticket = "abcdefghijklmnopqrstuv";
const pair = { id: "00000000-0000-0000-0000-000000000000", created_at: new Date() };
function request(body: Record<string, unknown>, headers?: HeadersInit) {
  return new Request("http://x/api/album", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const valid = { kind: "photo", contentType: "image/jpeg", sizeBytes: 100, happenedAt: "2026-01-01T00:00:00.000Z" };

beforeEach(() => {
  queries.length = 0;
  results = [];
  vi.unstubAllEnvs();
  vi.stubEnv("NEON_STORAGE_SECRET_ACCESS_KEY", SECRET);
  // Reset the behaviour, not just the call log. mockClear leaves the last
  // mockImplementation in place, so a test that makes signing fail would
  // silently poison every test declared after it.
  presign.mockReset();
  presign.mockImplementation(async (key: string) => ({
    uploadUrl: `put:${key}`,
    downloadUrl: `get:${key}`,
    key,
  }));
});

describe("POST /api/album", () => {
  it("returns 401 with neither a cookie nor bearer", async () => {
    expect((await POST(request(valid))).status).toBe(401);
    expect(queries).toHaveLength(0);
  });

  it("returns 401 for a well-formed ticket nobody holds", async () => {
    results = [[]];
    expect((await POST(request(valid, { authorization: `Bearer ${ticket}` }))).status).toBe(401);
  });

  it("refuses an oversize upload before presigning", async () => {
    results = [[pair]];
    const response = await POST(request({ ...valid, sizeBytes: 26 * 1024 * 1024 }, { authorization: `Bearer ${ticket}` }));
    expect(response.status).toBe(400);
    expect(presign).not.toHaveBeenCalled();
  });

  it("refuses a type outside the allowlist", async () => {
    results = [[pair]];
    const response = await POST(request({ ...valid, contentType: "application/pdf" }, { authorization: `Bearer ${ticket}` }));
    expect(response.status).toBe(400);
    expect(presign).not.toHaveBeenCalled();
  });

  it("ignores a key supplied by the client", async () => {
    results = [[pair]];
    const response = await POST(request({ ...valid, objectKey: "album/not-ours/photo-nope.jpg" }, { authorization: `Bearer ${ticket}` }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.objectKey).not.toBe("album/not-ours/photo-nope.jpg");
    expect(body.objectKey).toMatch(/^album\/2026\/01\/01_00-00-00_photo_[a-f0-9]{8}\.jpg$/);
  });

  it("files the photograph on the uploading phone's clock", async () => {
    // Midnight UTC on New Year's Day is still 7 pm on New Year's Eve in New York.
    results = [[pair]];
    const response = await POST(request({ ...valid, utcOffsetMinutes: -300 }, { authorization: `Bearer ${ticket}` }));
    const body = await response.json();
    expect(body.objectKey).toMatch(/^album\/2025\/12\/31_19-00-00_photo_[a-f0-9]{8}\.jpg$/);
    // The folder no longer says whose it is, so a receipt comes with it.
    expect(receiptMatches(SECRET, pair.id, body.objectKey, body.receipt)).toBe(true);
  });

  it("says storage is not set up rather than handing out an unprovable key", async () => {
    vi.stubEnv("NEON_STORAGE_SECRET_ACCESS_KEY", "");
    results = [[pair]];
    expect((await POST(request(valid, { authorization: `Bearer ${ticket}` }))).status).toBe(503);
    expect(presign).not.toHaveBeenCalled();
  });
});

describe("PUT /api/album", () => {
  const objectKey = "album/2026/01/01_00-00-00_photo_3f9a0c1e.jpg";
  const confirmation = { id: "abcdefghij", ...valid, objectKey, receipt: "" };

  it("refuses a malformed object key", async () => {
    results = [[pair]];
    const receipt = uploadReceipt(SECRET, pair.id, "not-an-album-key");
    const response = await PUT(request({ ...confirmation, objectKey: "not-an-album-key", receipt }, { authorization: `Bearer ${ticket}` }));
    expect(response.status).toBe(400);
    expect(queries).toHaveLength(1);
  });

  it("refuses a valid key confirmed without a receipt", async () => {
    results = [[pair]];
    const response = await PUT(request(confirmation, { authorization: `Bearer ${ticket}` }));
    expect(response.status).toBe(400);
    expect(queries).toHaveLength(1);
  });

  it("refuses a key whose receipt was issued to another pair", async () => {
    results = [[pair]];
    const receipt = uploadReceipt(SECRET, "11111111-1111-1111-1111-111111111111", objectKey);
    const response = await PUT(request({ ...confirmation, receipt }, { authorization: `Bearer ${ticket}` }));
    expect(response.status).toBe(400);
    expect(queries).toHaveLength(1);
  });

  it("records a key confirmed with this pair's own receipt", async () => {
    results = [[pair], [{ id: "abcdefghij" }]];
    const receipt = uploadReceipt(SECRET, pair.id, objectKey);
    const response = await PUT(request({ ...confirmation, receipt }, { authorization: `Bearer ${ticket}` }));
    expect(response.status).toBe(200);
    expect(queries.some((query) => query.includes("INSERT INTO album_items"))).toBe(true);
  });
});

describe("GET /api/album", () => {
  function row(id: string, objectKey: string) {
    return {
      id,
      pair_id: pair.id,
      object_key: objectKey,
      poster_key: null,
      kind: "photo",
      content_type: "image/jpeg",
      bytes: 10,
      happened_at: new Date("2026-02-02T00:00:00.000Z"),
      caption: null,
      loved: false,
      source_room: null,
      created_at: new Date("2026-02-03T00:00:00.000Z"),
      // Postgres keeps microseconds; a JS Date stops at milliseconds. The
      // gap between these two values is the bug this row exists to pin.
      cursor: "2026-02-03T00:00:00.000567Z",
    };
  }

  const authorized = () =>
    new Request("http://x/api/album", { headers: { authorization: `Bearer ${ticket}` } });

  it("refuses a caller holding no ticket, without asking the database", async () => {
    expect((await GET(new Request("http://x/api/album"))).status).toBe(401);
    expect(queries).toHaveLength(0);
  });

  it("serves the rest of the album when one item will not sign", async () => {
    // An album of four hundred memories that refuses to open because of one
    // broken row is a far worse outcome than one quietly showing 399 -- and a
    // person who cannot open the page has no way to discover which it was.
    presign.mockImplementation(async (key: string) =>
      key.includes("broken") ? null : { uploadUrl: `put:${key}`, downloadUrl: `get:${key}`, key },
    );
    results = [
      [pair],
      [row("good", `album/${pair.id}/photo-good.jpg`), row("bad", `album/${pair.id}/photo-broken.jpg`)],
      [],
    ];
    const response = await GET(authorized());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { id: string }[] };
    expect(body.items.map((item) => item.id)).toEqual(["good"]);
  });

  it("still reports trouble when nothing at all will sign", async () => {
    // Every item failing is storage being unreachable, not one bad row, and
    // an empty album would be a lie about that.
    presign.mockImplementation(async () => null);
    results = [[pair], [row("a", `album/${pair.id}/photo-a.jpg`)], []];
    expect((await GET(authorized())).status).toBe(503);
  });

  it("hands back a cursor taken from arrival order, not from happened_at", async () => {
    presign.mockImplementation(async (key: string) => ({
      uploadUrl: `put:${key}`,
      downloadUrl: `get:${key}`,
      key,
    }));
    results = [[pair], [row("a", `album/${pair.id}/photo-a.jpg`)], []];
    const body = (await (await GET(authorized())).json()) as { cursor: string };
    // Full microsecond precision, NOT the millisecond ISO string. Handing back
    // the truncated value asks for "rows after .000", which the row stored at
    // .000567 satisfies forever -- a poller would re-fetch the same photograph
    // on every pass and think each time that something new had arrived.
    expect(body.cursor).toBe("2026-02-03T00:00:00.000567Z");
    expect(body.cursor).not.toBe(new Date("2026-02-03T00:00:00.000Z").toISOString());
  });

  it("refuses a cursor that is not a date", async () => {
    results = [[pair]];
    const request = new Request("http://x/api/album?since=yesterday", {
      headers: { authorization: `Bearer ${ticket}` },
    });
    expect((await GET(request)).status).toBe(400);
  });
});
