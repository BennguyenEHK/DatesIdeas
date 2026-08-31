import { customAlphabet } from "nanoid";

/** No 0/O, 1/I/L — these get misread when a code is typed from a text message. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;

const generate = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);

export function newRoomCode(): string {
  return generate();
}

export function isValidRoomCode(v: string): boolean {
  const c = v.toUpperCase();
  if (c.length !== ROOM_CODE_LENGTH) return false;
  return [...c].every((ch) => ROOM_CODE_ALPHABET.includes(ch));
}
