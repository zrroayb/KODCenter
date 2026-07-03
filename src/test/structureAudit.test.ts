import { describe, expect, it } from "vitest";
import type { MarketContext } from "../lib/ict/types";
import { buildStructureAudit } from "../lib/signals/structureAudit";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";
import { createStructureContext } from "./strategyFixtures";

function scanSignal(overrides: Partial<MarketContext> = {}) {
  const context = createStructureContext(overrides);
  const signal = kodStrategy.scan({
    context,
    settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false }
  }).signals[0];
  expect(signal).toBeDefined();
  return signal;
}

describe("structure audit", () => {
  it("does not let UI or AI invent an FVG when the plan has no selected gap", () => {
    const signal = scanSignal({
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
      fairValueGaps: []
    });

    const audit = buildStructureAudit(signal);
    const fvg = audit.items.find((item) => item.label === "FVG/iFVG");

    expect(fvg?.status).not.toBe("pass");
    expect(fvg?.detail).toContain("FVG/iFVG kullanmıyor");
    expect(fvg?.detail).toContain("FVG varmış gibi konuşma");
  });

  it("explains the exact candle close needed when MSS/CISD is missing", () => {
    const signal = scanSignal({
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [],
      fairValueGaps: []
    });

    const audit = buildStructureAudit(signal);
    const mss = audit.items.find((item) => item.label === "MSS/CISD");

    expect(mss?.status).toBe("wait");
    expect(mss?.detail).toContain("mum");
    expect(mss?.detail).toContain("kapanışı bekleniyor");
  });

  it("marks invalidated ideas as blocked instead of trade candidates", () => {
    const signal = scanSignal({
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }]
    });
    const invalidated = {
      ...signal,
      stage: "invalidated" as const,
      outcome: { ...signal.outcome, status: "stopped" as const }
    };

    const audit = buildStructureAudit(invalidated);

    expect(audit.verdict).toBe("blocked");
    expect(audit.headline).toContain("Bozuldu");
    expect(audit.decision).toContain("yeni setup bekle");
    expect(audit.items.find((item) => item.label === "Risk")?.status).toBe("fail");
  });
});
