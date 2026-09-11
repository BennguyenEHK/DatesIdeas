import { describe, expect, it } from "vitest";
import { civilDate, civilMonth, occurrenceInYear, yearsSpanned } from "./occasions";

describe("album occasion dates", () => {
  it("uses the requested timezone's civil day rather than the instant's UTC day", () => {
    const instant = "2026-01-01T06:30:00Z";

    expect(civilDate(instant, "Asia/Ho_Chi_Minh")).toBe("2026-01-01");
    expect(civilDate(instant, "America/Los_Angeles")).toBe("2025-12-31");
    expect(civilMonth(instant, "America/Los_Angeles")).toBe("2025-12");
  });

  it("moves a leap-day yearly occasion to 28 February when needed", () => {
    expect(occurrenceInYear("2024-02-29", 2024)).toBe("2024-02-29");
    expect(occurrenceInYear("2024-02-29", 2025)).toBe("2025-02-28");
    expect(occurrenceInYear("2024-02-29", 2100)).toBe("2100-02-28");
  });

  it("lists every inclusive calendar year covered by reel dates", () => {
    expect(yearsSpanned(["2026-01-01", "2024-12-31", "2025-06-10"])).toEqual([2024, 2025, 2026]);
    expect(yearsSpanned([])).toEqual([]);
  });
});
