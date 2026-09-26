import { describe, expect, it } from "vitest";
import { buildTelegramReadyAlertPayload, readyTelegramDedupeKey } from "../lib/telegram/alertPayload";
import { alertableReadySignals } from "../lib/runtime/scanRuntime";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";
import { createStructureContext } from "./strategyFixtures";

function readySignal() {
  const base = createStructureContext();
  // New CRT model reads the raid off the anchor candles directly: h4[21] is the range candle
  // (101/95), h4[22] raids its high and closes back inside, h4[23] delivers lower.
  const h4 = base.timeframes.h4.map((candle, index) =>
    index === 21
      ? { ...candle, open: 100, high: 101, low: 95, close: 99 }
      : index === 22
        ? { ...candle, open: 99, high: 101.15, low: 96, close: 100.2 }
        : index === 23
          ? { ...candle, open: 96.2, high: 96.5, low: 95.5, close: 95.9 }
          : candle
  );
  const mappedM15 = base.timeframes.m15.map((candle, index) =>
    index === 18
      ? { ...candle, low: 99.4 }
    : index === 21
        ? { ...candle, open: 100.4, high: 100.8, low: 99.9, close: 100.6 }
    : index === 22
        ? { ...candle, open: 100.8, high: 101.15, low: 100.2, close: 100.5 }
        : index === 23
          ? { ...candle, open: 100.5, high: 100.6, low: 99.1, close: 99.3 }
          : candle
  );
  const lastM15 = mappedM15[mappedM15.length - 1];
  const m15 = [
    ...mappedM15,
    { ...lastM15, time: lastM15.time + 15 * 60 * 1000, open: 99.3, high: 99.8, low: 99.1, close: 99.4 },
    { ...lastM15, time: lastM15.time + 30 * 60 * 1000, open: 99.5, high: 100, low: 99.3, close: 99.7 }
  ];
  const context = createStructureContext({
    timeframes: { ...base.timeframes, m15, m5: m15, h4 },
    dealingRange: { high: 105, low: 90, midpoint: 97.5, source: "Telegram alert fixture" },
    premiumDiscount: { zone: "premium", positionPct: 0.72, midpoint: 97.5 },
    liquidityPools: [
      { id: "buy-side", side: "buy-side", level: 105, label: "Buy-side", strength: "strong" },
      { id: "sell-side", side: "sell-side", level: 90, label: "Sell-side", strength: "strong" }
    ],
    liquidityObjectives: [
      { id: "PDH", kind: "PDH", side: "buy-side", level: 101.4, label: "PDH", timeframe: "1d", source: "fixture", strength: "strong" },
      { id: "PDL", kind: "PDL", side: "sell-side", level: 95, label: "PDL", timeframe: "1d", source: "fixture", strength: "strong" }
    ],
    sweeps: [{ side: "buy-side", level: 101.3, candleIndex: 22, reclaimed: true }],
    displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
    marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
    fairValueGaps: [{ direction: "short", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: false }],
    crt: {
      rangeTimeframe: "4h",
      activeRange: { high: 105, low: 90, midpoint: 97.5, source: "Telegram CRT fixture" },
      selectedBias: {
        timeframe: "4h",
        kind: "bearish-reversal",
        direction: "short",
        drawLevel: 90,
        drawSide: "sell-side",
        rangeHigh: 105,
        rangeLow: 90,
        midpoint: 97.5,
        strength: "strong",
        summary: "4h previous high sweep + altında kapanış; DOL current low."
      },
      macroBiases: [],
      validPullback: true,
      pullbackSummary: "Bearish pullback valid.",
      pois: [{ type: "fvg", direction: "short", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: true, label: "FVG" }]
    }
  });

  const signals = crtStrategy.scan({
    context,
    settings: { ...crtStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
  }).signals;
  return signals.find((signal) => signal.crtAnchor?.origin === "standard" && signal.crtAnchor.raidActive) ?? signals[0];
}

describe("Telegram READY alert payload", () => {
  it("formats a READY payload with the EQ exit RR as the headline and DOL as extension", () => {
    const signal = readySignal();
    // The fixture's volatility-floor stop leaves less than 1R to EQ, so the stricter
    // live gate correctly keeps it WATCH. The formatter itself receives READY signals
    // only after the runtime gate has passed.
    expect(signal.stage).toBe("watch");
    const payload = buildTelegramReadyAlertPayload({ ...signal, stage: "ready" });

    expect(payload.stage).toBe("ready");
    expect(payload.dedupeKey).toBe(readyTelegramDedupeKey(signal));
    expect(payload.symbol).toBe("XAUUSD");
    expect(payload.direction).toBe("short");
    expect(payload.entry).toBe(signal.plan.entry);
    expect(payload.stopLoss).toBe(signal.plan.stopLoss);
    expect(payload.targets).toEqual(signal.plan.targets.slice(0, 2));
    // eq-full: the headline RR is the EQ exit's net RR; DOL is extension info only.
    expect(payload.rr).toBe(signal.plan.managementRR);
    expect(payload.extensionRR).toBeGreaterThanOrEqual(1.5);
    expect(payload.managementRR).toBe(signal.plan.managementRR);
    expect(payload.reasons.join(" ")).toContain("DOL uzatma");
    expect(payload.reasons.join(" ")).toContain("EQ net RR");
    expect(payload.reasons.join(" ")).toContain("Range hazır");
    expect(payload.reasons.join(" ")).toContain("Manipulation");
    expect(payload.reasons.join(" ")).toContain("ChoCH/Just");
    expect(payload.reasons.join(" ")).toContain("Giriş aktif");
    expect(payload.tradeContext?.symbol).toBe("XAUUSD");
    expect(payload.tradeContext?.checklist.length).toBeGreaterThan(0);
    expect(payload.tradeContext?.evidence.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(payload, "chartImages")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, "chartPngDataUrl")).toBe(false);
  });

  it("keeps the same Telegram dedupe key when only the signal id changes", () => {
    const signal = readySignal();
    const refreshedSignal = { ...signal, id: `${signal.id}-refreshed`, createdAt: signal.createdAt + 60_000 };

    expect(readyTelegramDedupeKey(refreshedSignal)).toBe(readyTelegramDedupeKey(signal));
    expect(readyTelegramDedupeKey(signal)).not.toBe(signal.id);
  });

});

describe("Telegram alert visibility parity", () => {
  it("only alerts READY signals the site actually lists — hidden signals never page the phone", () => {
    const ready = (id: string) => ({ id, stage: "ready" }) as unknown as import("../lib/ict/types").TradingSignal;
    const watch = (id: string) => ({ id, stage: "watch" }) as unknown as import("../lib/ict/types").TradingSignal;
    const result = {
      signals: [ready("xau-ready"), watch("eur-watch"), ready("xau-ready")],
      hiddenSignals: [ready("gbp-hidden-ready")],
      inactiveSignals: [],
      rejected: []
    } as unknown as Parameters<typeof alertableReadySignals>[0];

    const alertable = alertableReadySignals(result);

    expect(alertable.map((signal) => signal.id)).toEqual(["xau-ready"]);
  });
});
