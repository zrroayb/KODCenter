import { describe, expect, it } from "vitest";
import { buildSessionClock, formatTurkeySessionTime } from "../lib/session/sessionClock";

describe("session clock", () => {
  it("shows active session and next session countdown", () => {
    const asia = buildSessionClock(Date.UTC(2026, 6, 1, 0, 30));
    const london = buildSessionClock(Date.UTC(2026, 6, 1, 6, 0));
    const afterLondonClose = buildSessionClock(Date.UTC(2026, 6, 1, 20, 1));

    // TR referans tablosu (yaz, BST/EDT): Asia 02-05 TR = 23:00-02:00 UTC (gece yarısını sarar),
    // London 09-12 TR = 06-09 UTC, NY 14-17 TR = 11-14 UTC, London Close 17-19 TR = 14-16 UTC.
    expect(asia.activeSession).toBe("Asia");
    expect(asia.nextSession).toBe("London");
    expect(asia.minutesToNext).toBe(330);

    expect(london.activeSession).toBe("London");
    expect(london.nextSession).toBe("New York AM");
    expect(london.minutesToNext).toBe(300);

    expect(afterLondonClose.activeSession).toBe("Outside");
    expect(afterLondonClose.nextSession).toBe("Asia");
    expect(afterLondonClose.minutesToNext).toBe(179);
  });

  it("formats next session starts in Turkey time", () => {
    expect(formatTurkeySessionTime(Date.UTC(2026, 6, 1, 12, 30))).toBe("15:30");
  });
});
