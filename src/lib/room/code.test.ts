import { describe, it, expect } from "vitest";
import { newRoomCode, isValidRoomCode, ROOM_CODE_ALPHABET } from "./code";

describe("room codes", () => {
  it("generates 6 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const c = newRoomCode();
      expect(c).toHaveLength(6);
      for (const ch of c) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
  });

  it("excludes visually ambiguous characters", () => {
    for (const ch of ["0", "O", "1", "I", "L"]) {
      expect(ROOM_CODE_ALPHABET).not.toContain(ch);
    }
  });

  it("accepts its own output", () => {
    expect(isValidRoomCode(newRoomCode())).toBe(true);
  });

  it("normalizes case when validating", () => {
    const c = newRoomCode();
    expect(isValidRoomCode(c.toLowerCase())).toBe(true);
  });

  it("rejects wrong length and out-of-alphabet input", () => {
    expect(isValidRoomCode("ABC")).toBe(false);
    expect(isValidRoomCode("ABCDEFG")).toBe(false);
    expect(isValidRoomCode("ABC0EF")).toBe(false);
    expect(isValidRoomCode("")).toBe(false);
  });
});
