import { describe, expect, it } from "vitest";
import { buildSessionClock, formatTurkeySessionTime } from "../lib/session/sessionClock";

describe("session clock", () => {
  it("shows active session and next session countdown", () => {
    const asia = buildSessionClock(Date.UTC(2026, 6, 1, 2, 0));
    const outsideBeforeLondon = buildSessionClock(Date.UTC(2026, 6, 1, 6, 0));
    const afterNewYorkPm = buildSessionClock(Date.UTC(2026, 6, 1, 20, 1));

    expect(asia.activeSession).toBe("Asia");
    expect(asia.nextSession).toBe("London");
    expect(asia.minutesToNext).toBe(300);

    expect(outsideBeforeLondon.activeSession).toBe("Outside");
    expect(outsideBeforeLondon.nextSession).toBe("London");
    expect(outsideBeforeLondon.minutesToNext).toBe(60);

    expect(afterNewYorkPm.activeSession).toBe("Outside");
    expect(afterNewYorkPm.nextSession).toBe("Asia");
    expect(afterNewYorkPm.minutesToNext).toBe(239);
  });

  it("formats next session starts in Turkey time", () => {
    expect(formatTurkeySessionTime(Date.UTC(2026, 6, 1, 12, 30))).toBe("15:30");
  });
});
