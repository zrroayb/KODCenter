import { describe, expect, it } from "vitest";
import { buildSessionClock, formatTurkeySessionTime } from "../lib/session/sessionClock";

describe("session clock", () => {
  it("shows active session and next session countdown", () => {
    const asia = buildSessionClock(Date.UTC(2026, 6, 1, 2, 0));
    const outsideBeforeLondon = buildSessionClock(Date.UTC(2026, 6, 1, 6, 0));
    const afterNewYorkPm = buildSessionClock(Date.UTC(2026, 6, 1, 20, 1));

    // July = BST/EDT: London killzone 07:00-10:00 BST is 06:00-09:00 UTC.
    expect(asia.activeSession).toBe("Asia");
    expect(asia.nextSession).toBe("London");
    expect(asia.minutesToNext).toBe(240);

    expect(outsideBeforeLondon.activeSession).toBe("London");
    expect(outsideBeforeLondon.nextSession).toBe("New York AM");
    expect(outsideBeforeLondon.minutesToNext).toBe(330);

    expect(afterNewYorkPm.activeSession).toBe("Outside");
    expect(afterNewYorkPm.nextSession).toBe("Asia");
    expect(afterNewYorkPm.minutesToNext).toBe(239);
  });

  it("formats next session starts in Turkey time", () => {
    expect(formatTurkeySessionTime(Date.UTC(2026, 6, 1, 12, 30))).toBe("15:30");
  });
});
