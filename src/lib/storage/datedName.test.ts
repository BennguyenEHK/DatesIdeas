import { describe, expect, it } from "vitest";
import { DATED_PATTERN, datedParts, utcOffsetMinutes } from "./datedName";

describe("datedParts", () => {
  it("files an instant under its year and month, named by day and time", () => {
    expect(datedParts("2026-09-12T18:02:41.000Z", 0)).toEqual({
      folder: "2026/09",
      stamp: "12_18-02-41",
    });
  });

  it("uses the phone's clock, so a late evening stays on its own day", () => {
    // 11:30 pm in Chicago (UTC-5 in September) is 04:30 the next morning in UTC.
    expect(datedParts("2026-09-13T04:30:00.000Z", -300)).toEqual({
      folder: "2026/09",
      stamp: "12_23-30-00",
    });
  });

  it("rolls over the month and year on the phone's clock too", () => {
    // New Year's Eve at 10 pm in Chicago is already January in UTC.
    expect(datedParts("2027-01-01T04:00:00.000Z", -360)).toEqual({
      folder: "2026/12",
      stamp: "31_22-00-00",
    });
    // And the other way: just after midnight in Sydney is still the day before in UTC.
    expect(datedParts("2026-02-28T13:30:00.000Z", 660)).toEqual({
      folder: "2026/03",
      stamp: "01_00-30-00",
    });
  });

  it("keeps an old scanned photograph in its own year", () => {
    expect(datedParts("1998-05-14T19:32:05.000Z", 0).folder).toBe("1998/05");
  });

  it("keeps every folder four digits wide", () => {
    expect(datedParts("0500-01-01T00:00:00.000Z", 0).folder).toBe("1000/01");
  });

  it("refuses something that is not a date", () => {
    expect(() => datedParts("yesterday", 0)).toThrow(TypeError);
  });

  it("produces names the key checks recognise", () => {
    const { folder, stamp } = datedParts("2026-09-12T23:59:59.000Z", 0);
    expect(new RegExp(`^${DATED_PATTERN}$`).test(`${folder}/${stamp}`)).toBe(true);
    expect(new RegExp(`^${DATED_PATTERN}$`).test("2026/13/12_23-30-00")).toBe(false);
    expect(new RegExp(`^${DATED_PATTERN}$`).test("2026/09/12_24-00-00")).toBe(false);
  });
});

describe("utcOffsetMinutes", () => {
  it("accepts a real offset", () => {
    expect(utcOffsetMinutes(-300)).toBe(-300);
    expect(utcOffsetMinutes(345)).toBe(345);
    expect(utcOffsetMinutes(840)).toBe(840);
  });

  it("falls back to UTC for anything that is not one", () => {
    for (const value of [undefined, null, "-300", 1.5, Number.NaN, 900, -841]) {
      expect(utcOffsetMinutes(value)).toBe(0);
    }
  });
});
