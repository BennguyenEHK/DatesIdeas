import { describe, it, expect } from "vitest";
import { lineIndexAt, parseLrc } from "./lrc";

describe("parseLrc", () => {
  it("parses supported timestamp precision and long or single-digit minutes", () => {
    expect(parseLrc("[00:01] one\n[0:02.34] two\n[12:03.456] three")).toEqual([
      { atSec: 1, text: "one" },
      { atSec: 2.34, text: "two" },
      { atSec: 723.456, text: "three" },
    ]);
  });

  it("expands repeated timestamps and keeps empty lyric lines", () => {
    expect(parseLrc("[00:12.00][01:44.00] chorus\n[02:00.000]")).toEqual([
      { atSec: 12, text: "chorus" },
      { atSec: 104, text: "chorus" },
      { atSec: 120, text: "" },
    ]);
  });

  it("applies offset metadata to every timestamp and clamps before zero", () => {
    expect(parseLrc("[offset:+250]\n[00:00.00] early\n[00:01.00] later")).toEqual([
      { atSec: 0, text: "early" },
      { atSec: 0.75, text: "later" },
    ]);
    expect(parseLrc("[offset:-250]\n[00:01.00] later")).toEqual([
      { atSec: 1.25, text: "later" },
    ]);
  });

  it("ignores metadata, malformed lines, and accepts CRLF", () => {
    expect(parseLrc("[ar:Artist]\r\n[ti:Title]\r\nnot lyrics\r\n[00:03.00] words\r\n[length:01:00]")).toEqual([
      { atSec: 3, text: "words" },
    ]);
    expect(parseLrc("")).toEqual([]);
    expect(parseLrc("rubbish [00:01] never\n[00:1.2] bad")).toEqual([]);
  });

  it("sorts output by time", () => {
    expect(parseLrc("[00:10] later\n[00:02] first")).toEqual([
      { atSec: 2, text: "first" },
      { atSec: 10, text: "later" },
    ]);
  });
});

describe("lineIndexAt", () => {
  const lines = parseLrc("[00:01] one\n[00:03] three\n[00:03] also three\n[00:08] eight");

  it("returns the last line at or before the requested time", () => {
    expect(lineIndexAt(lines, 0.99)).toBe(-1);
    expect(lineIndexAt(lines, 1)).toBe(0);
    expect(lineIndexAt(lines, 3)).toBe(2);
    expect(lineIndexAt(lines, 7)).toBe(2);
    expect(lineIndexAt(lines, 8)).toBe(3);
  });

  it("handles empty input", () => {
    expect(lineIndexAt([], 10)).toBe(-1);
  });
});
