import { describe, expect, it } from "vitest";
import type { TradingSignal } from "../lib/ict/types";
import type { JournalEntry } from "../lib/journal/types";
import { applyCorrelationWarnings, correlationNote, dailyBrakeMessage, todayRealizedR } from "../lib/risk/portfolioRisk";
import { accountFromSettings, defaultAccountModel } from "../lib/risk/accountModel";

function signal(symbol: string, direction: "long" | "short", stage: TradingSignal["stage"] = "ready"): TradingSignal {
  return {
    symbol,
    direction,
    stage,
    governance: { warnings: [] },
    decisionSummary: { warnings: [] }
  } as unknown as TradingSignal;
}

describe("portfolio risk", () => {
  it("flags 2+ READY on the same USD exposure (EURUSD long + GBPUSD long = usd-short)", () => {
    const signals = [signal("EURUSD", "long"), signal("GBPUSD", "long"), signal("USDJPY", "long"), signal("AUDUSD", "long", "watch")];
    applyCorrelationWarnings(signals);
    expect(correlationNote(signals[0])).toContain("EURUSD, GBPUSD");
    expect(correlationNote(signals[1])).toContain("1/2");
    // USDJPY long is usd-long: a different bet. WATCH signals are not counted.
    expect(correlationNote(signals[2])).toBeUndefined();
    expect(correlationNote(signals[3])).toBeUndefined();
  });

  it("sums today's realized journal R and raises the -2R brake as a warning", () => {
    const now = Date.UTC(2026, 8, 26, 15);
    const entry = (r: number, closedAt: number): JournalEntry => ({ tradeId: String(r) + closedAt, createdAt: closedAt, updatedAt: closedAt, closedAt, strategy: "crt", symbol: "EURUSD", direction: "long", tradeAction: "taken", result: r > 0 ? "win" : "loss", rMultiple: r, ruleViolations: [] });
    const entries = [entry(-1, now - 3600e3), entry(-1.1, now - 7200e3), entry(-1, now - 30 * 3600e3)];
    expect(todayRealizedR(entries, now)).toEqual({ r: -2.1, trades: 2 });
    expect(dailyBrakeMessage(entries, now)).toContain("Günlük fren");
    expect(dailyBrakeMessage(entries.slice(0, 1), now)).toBeUndefined();
  });

  it("the account model comes from the user rules", () => {
    expect(accountFromSettings({ accountSize: 25_000, riskPerTradePct: 0.5 }).accountSize).toBe(25_000);
    expect(accountFromSettings({ accountSize: -1 }).accountSize).toBe(defaultAccountModel.accountSize);
  });
});
