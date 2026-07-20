import { describe, expect, it, vi } from "vitest";
import { buildTelegramReadyAlertPayload, notifyCrtContextSignalOnce, notifyReadySignalOnce, readyTelegramDedupeKey } from "../lib/telegram/readyAlert";
import { alertableReadySignals } from "../lib/runtime/scanRuntime";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";
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

type CandlePatch = { open: number; high: number; low: number; close: number };

function patchCandles<T extends { open: number; high: number; low: number; close: number }>(candles: T[], patches: Record<number, CandlePatch>): T[] {
  return candles.map((candle, index) => patches[index] ? { ...candle, ...patches[index] } : candle);
}

function dailyContextSignal() {
  const base = createStructureContext();
  const daily = patchCandles(base.timeframes.daily, {
    21: { open: 99, high: 100, low: 94, close: 98 },
    22: { open: 99, high: 101, low: 95, close: 98 },
    23: { open: 100, high: 105, low: 97, close: 102.4 }
  });
  const h1 = patchCandles(base.timeframes.h1, {
    22: { open: 102.2, high: 104, low: 102, close: 103.5 },
    23: { open: 103.5, high: 105.2, low: 103.2, close: 103.4 }
  });
  const context = createStructureContext({
    symbol: "GBPUSD",
    timeframes: { ...base.timeframes, daily, h1 },
    bias: { monthly: "bullish", weekly: "bullish", daily: "bullish", h4: "bullish", h1: "bullish" },
    premiumDiscount: { zone: "premium", positionPct: 0.74, midpoint: 98 },
    liquidityObjectives: [
      { id: "PDH", kind: "PDH", side: "buy-side", level: 105, label: "PDH", timeframe: "1d", source: "fixture", strength: "strong" },
      { id: "PDL", kind: "PDL", side: "sell-side", level: 95, label: "PDL", timeframe: "1d", source: "fixture", strength: "strong" }
    ]
  });
  return crtStrategy.scan({
    context,
    settings: { ...crtStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
  }).signals.find((signal) => signal.crtAnchor?.rangeTf === "1d");
}

function fvgOriginContextSignal() {
  const base = createStructureContext();
  const h4 = patchCandles(base.timeframes.h4, {
    18: { open: 99, high: 100, low: 98, close: 99.2 },
    19: { open: 99.2, high: 106, low: 99, close: 105.5 },
    20: { open: 105.5, high: 107, low: 102, close: 106.2 },
    21: { open: 106.2, high: 106.4, low: 101.4, close: 103.2 },
    22: { open: 103.2, high: 105.2, low: 102.8, close: 104.6 },
    23: { open: 104.6, high: 106.2, low: 104.1, close: 105.7 }
  });
  const m15 = base.timeframes.m15.map((candle) => ({ ...candle, open: 105, high: 105.4, low: 104.6, close: 105 }));
  const context = createStructureContext({
    timeframes: { ...base.timeframes, h4, m15, m5: m15 },
    bias: { monthly: "bullish", weekly: "bullish", daily: "bullish", h4: "bullish", h1: "bullish" },
    premiumDiscount: { zone: "discount", positionPct: 0.3, midpoint: 103.5 },
    liquidityObjectives: [
      { id: "PDH", kind: "PDH", side: "buy-side", level: 107, label: "PDH", timeframe: "1d", source: "fixture", strength: "strong" },
      { id: "PDL", kind: "PDL", side: "sell-side", level: 100, label: "PDL", timeframe: "1d", source: "fixture", strength: "strong" }
    ]
  });
  return crtStrategy.scan({
    context,
    settings: { ...crtStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
  }).signals.find((signal) => signal.crtAnchor?.origin === "fvg-origin");
}

describe("Telegram READY alert payload", () => {
  it("builds a readable READY payload with chart-safe trade plan fields and reasons", () => {
    const signal = readySignal();
    const payload = buildTelegramReadyAlertPayload(signal);

    expect(signal.stage).toBe("ready");
    expect(payload.stage).toBe("ready");
    expect(payload.dedupeKey).toBe(readyTelegramDedupeKey(signal));
    expect(payload.symbol).toBe("XAUUSD");
    expect(payload.direction).toBe("short");
    expect(payload.entry).toBe(signal.plan.entry);
    expect(payload.stopLoss).toBe(signal.plan.stopLoss);
    expect(payload.targets).toEqual(signal.plan.targets.slice(0, 2));
    expect(payload.rr).toBeGreaterThanOrEqual(1.5);
    expect(payload.reasons.join(" ")).toContain("Range hazır");
    expect(payload.reasons.join(" ")).toContain("Manipulation");
    expect(payload.reasons.join(" ")).toContain("ChoCH/Just");
    expect(payload.reasons.join(" ")).toContain("Giriş aktif");
    expect(payload.reasons.join(" ")).toContain("Karşı CRT kenarı hedef");
    expect(payload.tradeContext?.symbol).toBe("XAUUSD");
    expect(payload.tradeContext?.checklist.length).toBeGreaterThan(0);
    expect(payload.tradeContext?.evidence.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(payload, "chartImages")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, "chartPngDataUrl")).toBe(false);
  });

  it("does not POST Telegram alerts for WATCH setups", async () => {
    const context = createStructureContext({
      dealingRange: { high: 102, low: 99, midpoint: 100.5, source: "Low RR watch fixture" },
      liquidityPools: [
        { id: "buy-side", side: "buy-side", level: 102, label: "Buy-side", strength: "strong" },
        { id: "sell-side", side: "sell-side", level: 99, label: "Sell-side", strength: "strong" }
      ],
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
      fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: false }]
    });
    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 1.5 } }).signals[0];
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await notifyReadySignalOnce(signal);

    expect(signal.stage).toBe("watch");
    expect(result.status).toBe("disabled");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps the same Telegram dedupe key when only the signal id changes", () => {
    const signal = readySignal();
    const refreshedSignal = { ...signal, id: `${signal.id}-refreshed`, createdAt: signal.createdAt + 60_000 };

    expect(readyTelegramDedupeKey(refreshedSignal)).toBe(readyTelegramDedupeKey(signal));
    expect(readyTelegramDedupeKey(signal)).not.toBe(signal.id);
  });

  it("does not post a Daily raid through the context-only alert channel", async () => {
    const signal = dailyContextSignal();
    if (!signal) throw new Error("Daily context signal missing");
    expect(signal.stage).toBe("watch");
    expect(signal.direction).toBe("short");
    expect(signal.crtAnchor?.raidActive).toBe(true);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status: "sent" })
    } as Response);

    const result = await notifyCrtContextSignalOnce(signal);

    expect(result.status).toBe("disabled");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("does not post a low-quality 4H FVG origin context alert", async () => {
    const signal = fvgOriginContextSignal();
    if (!signal) throw new Error("FVG origin signal missing");
    expect(signal.stage).toBe("watch");
    expect(signal.crtAnchor?.origin).toBe("fvg-origin");
    expect(signal.score).toBeLessThan(50);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ status: "sent" })
    } as Response);

    const result = await notifyCrtContextSignalOnce(signal);

    expect(result.status).toBe("disabled");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
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
