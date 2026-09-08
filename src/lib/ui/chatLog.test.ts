import { describe, expect, it } from "vitest";
import { addLine, CHAT_KEEP, formatClock, type ChatLine } from "./chatLog";

function line(id: string, at: number): ChatLine {
  return { id, at, text: id, mine: false };
}

describe("addLine", () => {
  it("keeps a repeated data-channel delivery from becoming a repeated sentence", () => {
    const first = line("one", 1);
    expect(addLine([first], first)).toEqual([first]);
  });

  it("puts a late-arriving older message back in the order it was written", () => {
    expect(addLine([line("later", 20)], line("earlier", 10)).map(({ id }) => id)).toEqual([
      "earlier",
      "later",
    ]);
  });

  it("forgets the oldest lines once an evening has grown beyond its small window", () => {
    const full = Array.from({ length: CHAT_KEEP }, (_, index) => line(`${index}`, index));
    expect(addLine(full, line("newest", CHAT_KEEP)).map(({ id }) => id)).toEqual([
      ...Array.from({ length: CHAT_KEEP - 1 }, (_, index) => `${index + 1}`),
      "newest",
    ]);
  });
});

describe("formatClock", () => {
  it("uses the short, lowercase local clock used in the quiet message furniture", () => {
    const at = new Date(2026, 0, 1, 21, 14).getTime();
    expect(formatClock(at)).toBe("9:14pm");
  });
});
