import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  findKeepsake,
  isShareId,
  newShareId,
  rememberKeepsake,
  SHARE_ID_ALPHABET,
  SHARE_ID_LENGTH,
  type Keepsake,
  type SqlTag,
} from "./store";

function fakeSql(rows: Record<string, unknown>[] = []) {
  const calls: unknown[][] = [];
  const sql: SqlTag = async (_strings, ...values) => {
    calls.push(values);
    return rows;
  };
  return { calls, sql };
}

const keepsake: Keepsake = {
  id: "abcdefghjk",
  roomCode: "MAY-DANCE",
  objectKey: "keepsakes/MAY-DANCE/strip-example.png",
  kind: "strip",
  contentType: "image/png",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("share ids", () => {
  it("has the advertised length", () => {
    expect(SHARE_ID_LENGTH).toBe(10);
  });

  it("uses only the readable alphabet", () => {
    expect(SHARE_ID_ALPHABET).not.toMatch(/[lo10]/);
  });

  it("makes an id of the right length", () => {
    expect(newShareId()).toHaveLength(SHARE_ID_LENGTH);
  });

  it("makes an id from the advertised alphabet", () => {
    expect(newShareId().split("").every((character) => SHARE_ID_ALPHABET.includes(character))).toBe(true);
  });

  it("uses Web Crypto when it is available", () => {
    const getRandomValues = vi.fn((values: Uint8Array) => {
      values.fill(0);
      return values;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    expect(newShareId()).toBe("a".repeat(SHARE_ID_LENGTH));
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("falls back when Web Crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const id = newShareId();

    expect(isShareId(id)).toBe(true);
    expect(random).toHaveBeenCalled();
  });

  it.each(["abcdefghj", "abcdefghjkm"])('rejects an id with wrong length: %s', (id) => {
    expect(isShareId(id)).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(isShareId("ABCDEFGHJK")).toBe(false);
  });

  it.each(["l", "o", "1", "0"])('rejects excluded character %s', (excluded) => {
    expect(isShareId(`abcdefghi${excluded}`)).toBe(false);
  });

  it("accepts a correctly shaped id", () => {
    expect(isShareId(keepsake.id)).toBe(true);
  });
});

describe("rememberKeepsake", () => {
  it("returns true when the atomic insert returns a row", async () => {
    const fake = fakeSql([{ id: keepsake.id }]);

    await expect(rememberKeepsake(fake.sql, keepsake)).resolves.toBe(true);
  });

  it("returns false when the room is no longer open", async () => {
    const fake = fakeSql();

    await expect(rememberKeepsake(fake.sql, keepsake)).resolves.toBe(false);
  });

  it("issues exactly one query", async () => {
    const fake = fakeSql([{ id: keepsake.id }]);

    await rememberKeepsake(fake.sql, keepsake);

    expect(fake.calls).toHaveLength(1);
  });

  it("interpolates the room code for the expiry gate", async () => {
    const fake = fakeSql([{ id: keepsake.id }]);

    await rememberKeepsake(fake.sql, keepsake);

    expect(fake.calls[0]).toContain(keepsake.roomCode);
  });
});

describe("findKeepsake", () => {
  it("does not query malformed ids", async () => {
    const fake = fakeSql([{ id: keepsake.id }]);

    await expect(findKeepsake(fake.sql, "not-an-id")).resolves.toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it("returns null when no live row exists", async () => {
    const fake = fakeSql();

    await expect(findKeepsake(fake.sql, keepsake.id)).resolves.toBeNull();
  });

  it("maps every keepsake field", async () => {
    const fake = fakeSql([
      {
        id: keepsake.id,
        room_code: keepsake.roomCode,
        object_key: keepsake.objectKey,
        kind: keepsake.kind,
        content_type: keepsake.contentType,
      },
    ]);

    await expect(findKeepsake(fake.sql, keepsake.id)).resolves.toEqual(keepsake);
  });

  it("rejects an unknown kind", async () => {
    const fake = fakeSql([{ id: keepsake.id, room_code: "ROOM", object_key: "key", kind: "gif", content_type: "image/gif" }]);

    await expect(findKeepsake(fake.sql, keepsake.id)).resolves.toBeNull();
  });

  it("rejects a row with a missing column", async () => {
    const fake = fakeSql([{ id: keepsake.id, room_code: "ROOM", object_key: "key", kind: "strip" }]);

    await expect(findKeepsake(fake.sql, keepsake.id)).resolves.toBeNull();
  });

  it("rejects a row with a non-string column", async () => {
    const fake = fakeSql([{ id: keepsake.id, room_code: "ROOM", object_key: "key", kind: "strip", content_type: 42 }]);

    await expect(findKeepsake(fake.sql, keepsake.id)).resolves.toBeNull();
  });
});
