import { describe, expect, it, vi } from "vitest";
import { buildTelegramReadyAlertPayload, notifyReadySignalOnce, readyTelegramDedupeKey } from "../lib/telegram/readyAlert";
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
  const m15 = base.timeframes.m15.map((candle, index) =>
    index === 18
      ? { ...candle, low: 99.4 }
      : index === 22
        ? { ...candle, high: 101.3, low: 99.7, close: 100.1 }
        : index === 23
          ? { ...candle, open: 100.1, high: 100.3, low: 98.7, close: 98.8 }
          : candle
  );
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

  return crtStrategy.scan({
    context,
    settings: { ...crtStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
  }).signals[0];
}

describe("Telegram READY alert payload", () => {
  it("builds a readable READY payload with chart-safe trade plan fields and reasons", () => {
    const signal = readySignal();
    const payload = buildTelegramReadyAlertPayload(signal);

    expect(signal.stage).toBe("ready");
    expect(payload.stage).toBe("ready");
    expect(payload.symbol).toBe("XAUUSD");
    expect(payload.direction).toBe("short");
    expect(payload.entry).toBe(signal.plan.entry);
    expect(payload.stopLoss).toBe(signal.plan.stopLoss);
    expect(payload.targets).toEqual(signal.plan.targets.slice(0, 2));
    expect(payload.rr).toBeGreaterThanOrEqual(1.5);
    expect(payload.reasons.join(" ")).toContain("CRT bias");
    expect(payload.reasons.join(" ")).toContain("POI");
    expect(payload.reasons.join(" ")).toContain("Manipulation");
    expect(payload.reasons.join(" ")).toContain("ChoCH/Just");
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
});
