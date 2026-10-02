import { describe, expect, it } from "vitest";
import { alertWasDelivered, parseSentAlertState, SENT_ALERT_RETENTION_MS } from "../lib/telegram/sentAlertState";

describe("scanner sent-alert memory (Render free plan forgets its log while asleep)", () => {
  it("keeps fresh keys, drops expired ones and survives bad input", () => {
    const now = 1_000_000_000_000;
    const raw = JSON.stringify({ fresh: now - 1000, old: now - SENT_ALERT_RETENTION_MS - 1, junk: "x" });
    expect(parseSentAlertState(raw, now)).toEqual({ fresh: now - 1000 });
    expect(parseSentAlertState("not json", now)).toEqual({});
    expect(parseSentAlertState(undefined, now)).toEqual({});
    expect(parseSentAlertState("[1,2]", now)).toEqual({});
  });

  it("records only alerts Telegram actually has", () => {
    expect(alertWasDelivered("sent")).toBe(true);
    expect(alertWasDelivered("duplicate")).toBe(true);
    expect(alertWasDelivered("disabled")).toBe(false);
    expect(alertWasDelivered("error")).toBe(false);
    expect(alertWasDelivered(undefined)).toBe(false);
  });
});
