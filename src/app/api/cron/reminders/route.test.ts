import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: () => () => Promise.resolve([]) }));

const reminderCandidates = vi.fn();
const claimReminder = vi.fn();
vi.mock("@/lib/calendar/blocks", () => ({
  reminderCandidates: (...args: unknown[]) => reminderCandidates(...args),
  claimReminder: (...args: unknown[]) => claimReminder(...args),
}));

const devicesToNotify = vi.fn();
vi.mock("@/lib/push/devices", () => ({
  devicesToNotify: (...args: unknown[]) => devicesToNotify(...args),
}));

const sendToDevices = vi.fn();
vi.mock("@/lib/push/send", () => ({
  sendToDevices: (...args: unknown[]) => sendToDevices(...args),
}));

const { GET } = await import("./route");

const SECRET = "a".repeat(64);

function call(authorization?: string): Request {
  return new Request("http://x/api/cron/reminders", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

/** A block whose 30-minute reminder is due right now. */
function dueBlock() {
  const start = Date.now() + 29 * 60_000;
  return {
    id: "block-1",
    pairId: "11111111-1111-1111-1111-111111111111",
    title: "Dinner",
    note: null,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 3_600_000).toISOString(),
    zone: "UTC",
    owner: "both",
    repeat: "none",
    repeatUntil: null,
    remindMinutes: 30,
    remindedFor: null,
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  reminderCandidates.mockReset().mockResolvedValue([]);
  claimReminder.mockReset().mockResolvedValue(true);
  devicesToNotify.mockReset().mockResolvedValue([{ id: "d", endpoint: "https://x.test/a", p256dh: "k", auth: "t" }]);
  sendToDevices.mockReset().mockResolvedValue({ sent: 1, retired: 0 });
});

describe("GET /api/cron/reminders", () => {
  it("refuses to run at all when no secret is configured", async () => {
    // An unset secret must never mean "anyone may push to every couple".
    vi.stubEnv("CRON_SECRET", "");
    const response = await GET(call(`Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(reminderCandidates).not.toHaveBeenCalled();
  });

  it("refuses a caller without the secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await GET(call())).status).toBe(401);
    expect((await GET(call("Bearer wrong"))).status).toBe(401);
    expect((await GET(call(`Bearer ${SECRET}x`))).status).toBe(401);
    expect(reminderCandidates).not.toHaveBeenCalled();
  });

  it("sends a due reminder once it has claimed it", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    reminderCandidates.mockResolvedValue([dueBlock()]);

    const response = await GET(call(`Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    expect(claimReminder).toHaveBeenCalledTimes(1);
    expect(sendToDevices).toHaveBeenCalledTimes(1);
    const [, , notification] = sendToDevices.mock.calls[0];
    expect(notification).toMatchObject({ title: "Dinner", body: "Starts in 30 minutes.", url: "/calendar" });
  });

  it("claims before it sends, so two overlapping sweeps cannot both push", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    reminderCandidates.mockResolvedValue([dueBlock()]);
    const order: string[] = [];
    claimReminder.mockImplementation(async () => {
      order.push("claim");
      return true;
    });
    sendToDevices.mockImplementation(async () => {
      order.push("send");
      return { sent: 1, retired: 0 };
    });

    await GET(call(`Bearer ${SECRET}`));
    expect(order).toEqual(["claim", "send"]);
  });

  it("sends nothing when another sweep already claimed it", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    reminderCandidates.mockResolvedValue([dueBlock()]);
    claimReminder.mockResolvedValue(false);

    const body = await (await GET(call(`Bearer ${SECRET}`))).json();
    expect(sendToDevices).not.toHaveBeenCalled();
    expect(body).toEqual({ checked: 1, due: 1, sent: 0 });
  });

  it("does not claim a reminder that is not due yet", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const early = { ...dueBlock(), startsAt: new Date(Date.now() + 5 * 3_600_000).toISOString() };
    reminderCandidates.mockResolvedValue([early]);

    await GET(call(`Bearer ${SECRET}`));
    expect(claimReminder).not.toHaveBeenCalled();
    expect(sendToDevices).not.toHaveBeenCalled();
  });
});
