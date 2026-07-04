import { describe, expect, it, vi } from "vitest";
import { buildTelegramReadyAlertPayload, notifyReadySignalOnce, readyTelegramDedupeKey } from "../lib/telegram/readyAlert";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";
import { createStructureContext } from "./strategyFixtures";

function readySignal() {
  const context = createStructureContext({
    dealingRange: { high: 105, low: 97, midpoint: 101, source: "Telegram alert fixture" },
    liquidityPools: [
      { id: "buy-side", side: "buy-side", level: 105, label: "Buy-side", strength: "strong" },
      { id: "sell-side", side: "sell-side", level: 97, label: "Sell-side", strength: "strong" }
    ],
    sweeps: [{ side: "buy-side", level: 101.3, candleIndex: 23, reclaimed: true }],
    displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
    marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
    fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: false }]
  });

  return kodStrategy.scan({
    context,
    settings: { ...kodStrategy.defaultSettings, minimumRR: 1.5, useExecutionCosts: false }
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
    expect(payload.reasons.join(" ")).toContain("Entry modeli onaylı");
    expect(payload.reasons.join(" ")).toContain("Liquidity sweep");
    expect(payload.reasons.join(" ")).toContain("MSS / CISD");
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
