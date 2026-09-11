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
const { POST, PUT, GET } = await import("./route");

const ticket = "abcdefghijklmnopqrstuv";
const pair = { id: "00000000-0000-0000-0000-000000000000", created_at: new Date() };
function request(body: Record<string, unknown>, headers?: HeadersInit) {
  return new Request("http://x/api/album", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
const valid = { kind: "photo", contentType: "image/jpeg", sizeBytes: 100, happenedAt: "2026-01-01T00:00:00.000Z" };

beforeEach(() => {
  queries.length = 0;
  results = [];
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
    expect(body.objectKey).toContain(pair.id);
  });
});

describe("PUT /api/album", () => {
  const confirmation = { id: "abcdefghij", ...valid, objectKey: "album/00000000-0000-0000-0000-000000000000/photo-token.jpg" };

  it("refuses a malformed object key", async () => {
    results = [[pair]];
    const response = await PUT(request({ ...confirmation, objectKey: "not-an-album-key" }, { authorization: `Bearer ${ticket}` }));
    expect(response.status).toBe(400);
    expect(queries).toHaveLength(1);
  });

  it("refuses an otherwise valid key belonging to another pair", async () => {
    results = [[pair]];
    const response = await PUT(request({ ...confirmation, objectKey: "album/11111111-1111-1111-1111-111111111111/photo-token.jpg" }, { authorization: `Bearer ${ticket}` }));
    expect(response.status).toBe(400);
    expect(queries).toHaveLength(1);
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
