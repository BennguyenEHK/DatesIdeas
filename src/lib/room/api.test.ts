import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoom, fetchRoomStatus } from "./api";

const ok = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe("createRoom", () => {
  it("returns the code and when it closes", async () => {
    vi.stubGlobal("fetch", ok({ code: "ABCDEF", expiresAt: "2026-09-03T20:00:00.000Z" }, 201));
    expect(await createRoom()).toEqual({
      code: "ABCDEF",
      expiresAt: "2026-09-03T20:00:00.000Z",
    });
  });

  it("returns nothing when the server could not open a room", async () => {
    // The caller shows a message; it must not navigate to a room that is not
    // there, which would strand you on a page waiting for a peer forever.
    vi.stubGlobal("fetch", ok({ error: "no free code" }, 503));
    expect(await createRoom()).toBeNull();
  });

  it("returns nothing when the network is down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await createRoom()).toBeNull();
  });

  it("refuses a code the server sent that is not a room code", async () => {
    vi.stubGlobal("fetch", ok({ code: "../../etc", expiresAt: null }, 201));
    expect(await createRoom()).toBeNull();
  });
});

describe("fetchRoomStatus", () => {
  it("reports what the server says", async () => {
    vi.stubGlobal("fetch", ok({ status: "expired", expiresAt: "2026-09-01T00:00:00.000Z" }));
    expect(await fetchRoomStatus("ABCDEF")).toEqual({
      status: "expired",
      expiresAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("assumes the room is open when it cannot ask", async () => {
    // Erring the other way would shut two people out of a working room over a
    // dropped request. Signalling is the real gate and it fails closed; this
    // is only what the page displays, so it fails open.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchRoomStatus("ABCDEF")).toEqual({
      status: "open",
      expiresAt: null,
    });
  });

  it("assumes the room is open when the server errors", async () => {
    vi.stubGlobal("fetch", ok({ error: "boom" }, 500));
    expect((await fetchRoomStatus("ABCDEF")).status).toBe("open");
  });

  it("does not trust a status it does not recognise", async () => {
    vi.stubGlobal("fetch", ok({ status: "banana", expiresAt: null }));
    expect((await fetchRoomStatus("ABCDEF")).status).toBe("open");
  });

  it("asks about the code it was given", async () => {
    const f = ok({ status: "open", expiresAt: null });
    vi.stubGlobal("fetch", f);
    await fetchRoomStatus("ABCDEF");
    expect(f.mock.calls[0][0]).toContain("code=ABCDEF");
  });
});
