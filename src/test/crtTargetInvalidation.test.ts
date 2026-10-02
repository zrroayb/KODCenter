import { describe, expect, it } from "vitest";
import type { Candle, SmtDivergence } from "../lib/ict/types";
import { crtTargetInvalidation } from "../lib/strategies/crt/targetInvalidation";

const bar = (time: number, open: number, high: number, low: number, close: number): Candle =>
  ({ time, open, high, low, close, volume: 1, closed: true });

const smt = (direction: "long" | "short", time: number): SmtDivergence => ({
  partner: "GBPUSD", direction, side: direction === "short" ? "buy-side" : "sell-side",
  candleIndex: 0, time, localLevel: 0, partnerLevel: 0, localExtreme: 0, partnerExtreme: 0, note: ""
});

// Long filled at index 1; swing low at index 3 (low 101); index 5 closes below it.
const candles = [
  bar(0, 100, 101, 99, 100.5),
  bar(1, 100.5, 102, 100, 101.5), // entry (retest) candle
  bar(2, 101.5, 104, 101.5, 103.5),
  bar(3, 103.5, 104, 101, 102),   // swing low 101
  bar(4, 102, 103.5, 102, 103),
  bar(5, 103, 103, 100.4, 100.6)  // body close below 101 = opposing MSS
];

describe("CRT target invalidation (CRT Secrets §4: opposing SMT + MSS cancels the DOL)", () => {
  it("warns when an opposing SMT after the fill meets a close through the latest opposing swing", () => {
    const result = crtTargetInvalidation({ candles, direction: "long", entryIndex: 1, smtDivergences: [smt("short", 4)] });
    expect(result?.level).toBe(101);
    expect(result?.breakIndex).toBe(5);
    expect(result?.message).toContain("Hedef iptal riski");
  });

  it("needs BOTH: no warning without the opposing SMT, or with an SMT from before the fill", () => {
    expect(crtTargetInvalidation({ candles, direction: "long", entryIndex: 1, smtDivergences: [] })).toBeUndefined();
    expect(crtTargetInvalidation({ candles, direction: "long", entryIndex: 1, smtDivergences: [smt("short", 0)] })).toBeUndefined();
    // A same-direction SMT supports the trade, it does not cancel it.
    expect(crtTargetInvalidation({ candles, direction: "long", entryIndex: 1, smtDivergences: [smt("long", 4)] })).toBeUndefined();
  });

  it("no warning while the opposing swing holds", () => {
    const held = [...candles.slice(0, 5), bar(5, 103, 104, 101.2, 103.8)];
    expect(crtTargetInvalidation({ candles: held, direction: "long", entryIndex: 1, smtDivergences: [smt("short", 4)] })).toBeUndefined();
  });

  it("the Telegram exit payload is built only for an open trade carrying the warning", async () => {
    const { buildTelegramExitAlertPayload } = await import("../lib/telegram/alertPayload");
    const { createDemoMarkets } = await import("../data/demoData");
    const { buildMarketContext } = await import("../lib/intelligence/marketContext");
    const { crtStrategy } = await import("../lib/strategies/crt/crt.strategy");
    const signal = createDemoMarkets().flatMap((market) => crtStrategy.scan({ context: buildMarketContext(market.symbol, market.timeframes), settings: crtStrategy.defaultSettings }).signals)[0];
    expect(signal).toBeDefined();
    const open = { ...signal, outcome: { ...signal.outcome, status: "open" as const }, crtAnchor: { ...signal.crtAnchor!, exitWarning: "Hedef iptal riski: test" } };
    const payload = buildTelegramExitAlertPayload(open);
    expect(payload?.alertKind).toBe("exit");
    expect(payload?.dedupeKey?.startsWith("exit|")).toBe(true);
    expect(payload?.reasons).toEqual(["Hedef iptal riski: test"]);
    expect(buildTelegramExitAlertPayload({ ...open, outcome: { ...open.outcome, status: "tp2" } })).toBeUndefined();
  });
});
