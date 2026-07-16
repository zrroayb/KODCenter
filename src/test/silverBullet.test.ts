import { describe, expect, it } from "vitest";
import type { Candle, MarketContext } from "../lib/ict/types";
import { buildSilverBulletReferenceRange, nyHourToUtc, nyTradingDayId } from "../lib/strategies/silverBullet/referenceRange";
import { evaluateSilverBullet, silverBulletTransitionLog } from "../lib/strategies/silverBullet/silverBulletEngine";
import { createStructureContext } from "./strategyFixtures";

const M5 = 5 * 60 * 1000;
// 2026-07-15 is EDT (UTC-4); 2026-01-14 is EST (UTC-5) — both Wednesdays.
const JUL = Date.UTC(2026, 6, 15, 12, 0); // 08:00 NY in July
const JAN = Date.UTC(2026, 0, 14, 13, 0); // 08:00 NY in January

function bar(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 100, closed: true };
}

// Builds a flat pre-09:00 backdrop plus a scripted 09:00-11:00 NY tape.
function tape(anchor: number, script: Array<Partial<Candle>>): Candle[] {
  const start09 = nyHourToUtc(anchor, 9);
  const candles: Candle[] = [];
  // 40 backdrop bars before 09:00 with unit range for a stable ATR of ~1.
  for (let index = 40; index >= 1; index -= 1) {
    candles.push(bar(start09 - index * M5, 100, 100.5, 99.5, 100));
  }
  script.forEach((patch, index) => {
    const time = start09 + index * M5;
    candles.push({ ...bar(time, 100, 100.5, 99.5, 100), ...patch, time });
  });
  return candles;
}

// Reference hour: 12 bars ranging 99-101 (high at bar 3, low at bar 7).
function referenceHour(): Array<Partial<Candle>> {
  return Array.from({ length: 12 }, (_, index) => index === 3
    ? { open: 100.2, high: 101, low: 100, close: 100.6 }
    : index === 7
      ? { open: 100, high: 100.4, low: 99, close: 99.8 }
      : { open: 100, high: 100.5, low: 99.6, close: 100.1 });
}

function contextFor(candles: Candle[], biases: { daily?: string; h4?: string; h1?: string } = {}): MarketContext {
  const base = createStructureContext();
  return {
    ...base,
    symbol: "NAS100",
    timeframes: { ...base.timeframes, m5: candles, m15: candles },
    bias: { ...base.bias, daily: (biases.daily ?? "bearish") as never, h4: (biases.h4 ?? "bearish") as never, h1: (biases.h1 ?? "bearish") as never }
  } as MarketContext;
}

describe("Silver Bullet reference range", () => {
  it("builds and locks the 09:00-10:00 NY reference and never repaints it after 10:00", () => {
    const candles = tape(JUL, [
      ...referenceHour(),
      { open: 100, high: 103, low: 99.9, close: 102.5 } // 10:00 bar spikes way above — must NOT touch the reference
    ]);
    const reference = buildSilverBulletReferenceRange({ symbol: "NAS100", candles, now: nyHourToUtc(JUL, 10) + M5 });
    expect(reference?.isComplete).toBe(true);
    expect(reference?.high).toBe(101);
    expect(reference?.low).toBe(99);
    expect(reference?.midpoint).toBe(100);
    expect(reference?.barCount).toBe(12);
    expect(reference?.tradingDayId).toBe(nyTradingDayId(JUL));
  });

  it("handles DST: the same 09:00 NY wall-clock maps to different UTC hours in Jan vs Jul", () => {
    const julStart = nyHourToUtc(JUL, 9);
    const janStart = nyHourToUtc(JAN, 9);
    expect(new Date(julStart).getUTCHours()).toBe(13); // EDT = UTC-4
    expect(new Date(janStart).getUTCHours()).toBe(14); // EST = UTC-5
  });

  it("flags an incomplete reference as NO_TRADE material", () => {
    const candles = tape(JUL, referenceHour().slice(0, 6)); // only half the hour present
    const reference = buildSilverBulletReferenceRange({ symbol: "NAS100", candles, now: nyHourToUtc(JUL, 10) + M5 });
    expect(reference?.dataQuality).toBe("incomplete");
    expect(reference?.isComplete).toBe(false);
  });
});

describe("Silver Bullet window engine", () => {
  // Bearish script: high sweep at 10:05, reclaim 10:10, displacement 10:15 leaving an FVG,
  // retracement fills the entry, then delivery toward the opposite side.
  // Everything stays INSIDE the 99-101 reference until after the fill: a pre-entry touch of the
  // opposite extreme is (correctly) rejected as both-sides/target-already-delivered.
  function bearishScript(): Array<Partial<Candle>> {
    return [
      ...referenceHour(),
      { open: 100.2, high: 100.8, low: 100, close: 100.6 },     // 10:00
      { open: 100.6, high: 101.6, low: 100.5, close: 101.3 },   // 10:05 sweeps high (101), one close outside
      { open: 101.3, high: 101.4, low: 100.6, close: 100.7 },   // 10:10 reclaim (close back inside) — FVG first bar (low 100.6)
      { open: 100.7, high: 100.75, low: 99.55, close: 99.65 },  // 10:15 displacement (body ~1.05×ATR, %87 gövde)
      { open: 99.65, high: 100.1, low: 99.4, close: 99.9 },     // 10:20 third bar → bearish FVG 100.1-100.6 (CE 100.35)
      { open: 99.9, high: 100.45, low: 99.8, close: 100.0 },    // 10:25 retracement into the FVG → entry fills
      { open: 100.0, high: 100.05, low: 99.6, close: 99.7 },    // 10:30 delivery toward midpoint (TP1)
      { open: 99.7, high: 99.8, low: 99.3, close: 99.4 }        // 10:35 still above the opposite extreme
    ];
  }

  it("confirms a bearish high-sweep Silver Bullet with MSS/CISD + FVG and fills before 11:00", () => {
    const candles = tape(JUL, bearishScript());
    const setup = evaluateSilverBullet({
      context: contextFor(candles),
      now: nyHourToUtc(JUL, 10) + 8 * M5,
      config: { displacementBodyToAtrMin: 1.0, minimumRR: 0.5 }
    });
    expect(setup).toBeDefined();
    expect(setup?.direction).toBe("short");
    expect(setup?.setupModel).toBe("NY_AM_09_RANGE_HIGH_SWEEP_BEARISH_SB");
    expect(setup?.sweep?.side).toBe("HIGH");
    expect(setup?.sweep?.reclaimed).toBe(true);
    expect(setup?.cisd || setup?.mss).toBeTruthy();
    expect(setup?.entryArray?.type).toBe("FVG");
    expect(setup?.plan?.entryFilledUtc).toBeDefined();
    expect(["ENTRY_FILLED", "ACTIVE", "TARGET_1_REACHED", "COMPLETED", "STOPPED"]).toContain(setup?.lifecycleStatus);
    expect(setup?.triggerType).toMatch(/SB_(MSS|CISD)_FVG/);
  });

  it("rejects the reversal when price ACCEPTS outside the range (closes outside, no reclaim)", () => {
    const candles = tape(JUL, [
      ...referenceHour(),
      { open: 100.2, high: 101.6, low: 100.1, close: 101.4 }, // sweep + close outside 1
      { open: 101.4, high: 102.0, low: 101.2, close: 101.9 }, // close outside 2 → acceptance
      { open: 101.9, high: 102.4, low: 101.7, close: 102.3 }
    ]);
    const setup = evaluateSilverBullet({ context: contextFor(candles), now: nyHourToUtc(JUL, 10) + 4 * M5 });
    expect(setup?.lifecycleStatus).toBe("BREAK_ACCEPTED_OUTSIDE");
    expect(setup?.invalidationReasons.join(" ")).toContain("continuation");
  });

  it("rejects when both reference sides are swept", () => {
    const candles = tape(JUL, [
      ...referenceHour(),
      { open: 100.2, high: 101.4, low: 100, close: 100.6 },  // high swept
      { open: 100.6, high: 100.7, low: 98.7, close: 98.9 }   // low swept too
    ]);
    const setup = evaluateSilverBullet({ context: contextFor(candles), now: nyHourToUtc(JUL, 10) + 3 * M5 });
    expect(setup?.lifecycleStatus).toBe("BOTH_SIDES_SWEPT");
  });

  it("declares a no-sweep NO_TRADE day when the window closes untouched", () => {
    const flatWindow = Array.from({ length: 12 }, () => ({ open: 100, high: 100.6, low: 99.4, close: 100 }));
    const candles = tape(JUL, [...referenceHour(), ...flatWindow]);
    const setup = evaluateSilverBullet({ context: contextFor(candles), now: nyHourToUtc(JUL, 11) + M5 });
    expect(setup?.lifecycleStatus).toBe("NO_TRADE");
    expect(setup?.noTradeReasons.join(" ")).toContain("sweep gelmedi");
  });

  it("expires an unfilled entry at the 11:00 deadline (strict fill rule)", () => {
    // Same bearish sequence but price never retraces into the FVG (and never takes the low).
    const candles = tape(JUL, [
      ...referenceHour(),
      { open: 100.2, high: 100.8, low: 100, close: 100.6 },
      { open: 100.6, high: 101.6, low: 100.5, close: 101.3 },
      { open: 101.3, high: 101.4, low: 100.6, close: 100.7 },
      { open: 100.7, high: 100.75, low: 99.55, close: 99.65 },
      { open: 99.65, high: 100.1, low: 99.4, close: 99.9 },
      { open: 99.9, high: 100.1, low: 99.5, close: 99.6 },
      { open: 99.6, high: 99.9, low: 99.4, close: 99.8 }
    ]);
    const setup = evaluateSilverBullet({
      context: contextFor(candles),
      now: nyHourToUtc(JUL, 11) + M5,
      config: { displacementBodyToAtrMin: 1.0, minimumRR: 0.5 }
    });
    expect(setup?.lifecycleStatus).toBe("EXPIRED");
    expect(setup?.noTradeReasons.join(" ")).toContain("DOLMADI");
  });

  it("keeps HTF conflict as a scored warning, never a silent gate (BIAS_SCORED)", () => {
    const candles = tape(JUL, bearishScript());
    const setup = evaluateSilverBullet({
      context: contextFor(candles, { daily: "bullish", h4: "bullish", h1: "bullish" }),
      now: nyHourToUtc(JUL, 10) + 8 * M5,
      config: { displacementBodyToAtrMin: 1.0, minimumRR: 0.5 }
    });
    expect(setup?.htfAlignment).toBe("conflicting");
    expect(setup?.plan?.entryFilledUtc).toBeDefined(); // mechanical trigger still logged
    expect(setup?.warnings.join(" ")).toContain("BIAS_SCORED");
  });

  it("emits idempotent lifecycle logs (same status never logs twice)", () => {
    const candles = tape(JUL, bearishScript());
    const setup = evaluateSilverBullet({ context: contextFor(candles), now: nyHourToUtc(JUL, 10) + 8 * M5, config: { displacementBodyToAtrMin: 1.0, minimumRR: 0.5 } })!;
    const created = silverBulletTransitionLog(undefined, setup);
    const repeat = silverBulletTransitionLog(setup, setup);
    expect(created?.eventType).toBe("CREATED");
    expect(created?.eventNamespace).toBe("SILVER_BULLET_SETUP");
    expect(repeat).toBeUndefined();
    expect(setup.idempotencyKey).toContain("NAS100");
    expect(setup.idempotencyKey).toContain("NY_AM_09_HOURLY_RANGE_REVERSAL_V1");
  });
});
