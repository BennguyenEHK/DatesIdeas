import { describe, it, expect } from "vitest";
import { REMINDER_LOOKBACK_MS, dueOccurrence, reminderBody, type ReminderCandidate } from "./remind";

function candidate(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    id: "b1",
    title: "Dinner",
    startsAt: "2026-05-10T19:00:00.000Z",
    endsAt: "2026-05-10T21:00:00.000Z",
    zone: "UTC",
    repeat: "none",
    repeatUntil: null,
    remindMinutes: 30,
    remindedFor: null,
    ...overrides,
  };
}

const at = (iso: string) => new Date(iso);

describe("when a reminder is due", () => {
  it("is due once its lead time has arrived", () => {
    expect(dueOccurrence(candidate(), at("2026-05-10T18:30:00.000Z"))).toBe("2026-05-10T19:00:00.000Z");
  });

  it("is not due before the lead time", () => {
    expect(dueOccurrence(candidate(), at("2026-05-10T18:29:00.000Z"))).toBeNull();
  });

  it("still goes out when the sweep runs a few minutes late", () => {
    // A sweep never runs on the exact second. Twenty minutes late is still a
    // useful "it is nearly time".
    expect(dueOccurrence(candidate(), at("2026-05-10T18:50:00.000Z"))).toBe("2026-05-10T19:00:00.000Z");
  });

  it("does not go out once it is too late to be a reminder", () => {
    const tooLate = new Date(Date.parse("2026-05-10T18:30:00.000Z") + REMINDER_LOOKBACK_MS + 60_000);
    expect(dueOccurrence(candidate(), tooLate)).toBeNull();
  });

  it("is not sent twice for the same occurrence", () => {
    const sent = candidate({ remindedFor: "2026-05-10T19:00:00.000Z" });
    expect(dueOccurrence(sent, at("2026-05-10T18:35:00.000Z"))).toBeNull();
  });
});

describe("repeating blocks", () => {
  it("remind again next week, without reminding twice this week", () => {
    const weekly = candidate({ repeat: "weekly", remindedFor: "2026-05-10T19:00:00.000Z" });
    expect(dueOccurrence(weekly, at("2026-05-10T18:40:00.000Z"))).toBeNull();
    expect(dueOccurrence(weekly, at("2026-05-17T18:30:00.000Z"))).toBe("2026-05-17T19:00:00.000Z");
  });

  it("still remind for a block that has been repeating for years", () => {
    const daily = candidate({ repeat: "daily", startsAt: "2023-01-01T19:00:00.000Z", endsAt: "2023-01-01T20:00:00.000Z" });
    expect(dueOccurrence(daily, at("2026-05-10T18:30:00.000Z"))).toBe("2026-05-10T19:00:00.000Z");
  });

  it("stop once the repeat has ended", () => {
    const ended = candidate({ repeat: "daily", repeatUntil: "2026-05-08" });
    expect(dueOccurrence(ended, at("2026-05-10T18:30:00.000Z"))).toBeNull();
  });
});

describe("a day's notice", () => {
  it("is due a full day before", () => {
    const early = candidate({ remindMinutes: 1440 });
    expect(dueOccurrence(early, at("2026-05-09T19:00:00.000Z"))).toBe("2026-05-10T19:00:00.000Z");
  });
});

describe("reminderBody", () => {
  it("phrases the lead time rather than a clock time, which would be wrong in the other zone", () => {
    expect(reminderBody(0)).toBe("Starting now.");
    expect(reminderBody(10)).toBe("Starts in 10 minutes.");
    expect(reminderBody(60)).toBe("Starts in an hour.");
    expect(reminderBody(180)).toBe("Starts in 3 hours.");
    expect(reminderBody(1440)).toBe("Starts tomorrow, at this time.");
    expect(reminderBody(4320)).toBe("Starts in 3 days.");
  });
});
