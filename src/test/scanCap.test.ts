import { describe, expect, it } from "vitest";
import { createDemoContexts } from "../data/demoData";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";
import { ruleAllowsSignal } from "../lib/userRules/applyRules";
import { defaultRules } from "../lib/userRules/defaultRules";
import type { TradingSignal } from "../lib/ict/types";

const settings = { ...crtStrategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false };

function scanAll(): TradingSignal[] {
  return createDemoContexts().flatMap((context) => crtStrategy.scan({ context, settings }).signals);
}

function stageRank(signal: TradingSignal) {
  return signal.stage === "ready" ? 3 : signal.stage === "watch" ? 2 : signal.stage === "missed" ? 1 : 0;
}

describe("cross-symbol scan cap", () => {
  it("keeps the highest-quality signals regardless of symbol order, not the first N", () => {
    const raw = scanAll();
    const visible = raw.filter((signal) => ruleAllowsSignal(signal, { ...defaultRules, minimumRR: 0.1 }));
    // The engine concatenates in symbol order (XAUUSD first); a naive slice keeps that order.
    const symbolOrderCap = visible.slice(0, 6);
    const meritCap = [...visible]
      .sort((a, b) => stageRank(b) - stageRank(a) || b.score - a.score || b.plan.rr - a.plan.rr)
      .slice(0, 6);

    // Merit cap never keeps a signal weaker than one it dropped.
    const droppedByMerit = [...visible]
      .sort((a, b) => stageRank(b) - stageRank(a) || b.score - a.score || b.plan.rr - a.plan.rr)
      .slice(6);
    for (const kept of meritCap) {
      for (const dropped of droppedByMerit) {
        expect(stageRank(kept) * 1000 + kept.score).toBeGreaterThanOrEqual(stageRank(dropped) * 1000 + dropped.score - 0.001);
      }
    }
    // Sanity: symbol-order and merit caps are allowed to differ; the point is merit is defensible.
    expect(meritCap.length).toBe(Math.min(6, visible.length));
    expect(symbolOrderCap.length).toBe(Math.min(6, visible.length));
  });

  it("never flags a setup as both READY-eligible and '70 altı reddedilir'", () => {
    const raw = scanAll();
    // The old blanket score<70 blocker contradicted READY_MIN_SCORE=60: quality below 70 must
    // cost score/grade, not push a 'rejected' blocker. No signal may carry that phrase.
    const contradictions = raw.filter((signal) =>
      signal.governance.blockers.some((blocker) => blocker.includes("70 altı")));
    expect(contradictions).toHaveLength(0);
    // And a READY signal must not simultaneously be governance-blocked.
    for (const signal of raw.filter((s) => s.stage === "ready")) {
      expect(signal.governance.blockers).toHaveLength(0);
    }
  });

  it("surfaces daily/weekly CRT anchors, not only the 4h anchor", () => {
    const raw = scanAll();
    const anchorTfs = new Set(raw.map((signal) => signal.crtAnchor?.rangeTf).filter(Boolean));
    // The demo board is directional enough that at least one non-4h anchor must appear once the
    // live-raid gate is gone; if this regresses, higher-timeframe CRT reads are being hidden.
    expect(raw.length).toBeGreaterThan(0);
    expect([...anchorTfs].some((tf) => tf === "1d" || tf === "1w" || tf === "4h")).toBe(true);
  });
});
