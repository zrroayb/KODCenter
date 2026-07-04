import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BacktestView } from "../components/BacktestView";
import type { BacktestResult } from "../lib/analytics/performance";

function replayResult(): BacktestResult {
  return {
    totalTrades: 0,
    winRate: 0,
    lossRate: 0,
    averageRR: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    maxWinStreak: 0,
    maxLossStreak: 0,
    bestKillzone: "Runtime replay",
    bestSymbol: "GBPUSD",
    bestSetupGrade: "A",
    bestPremiumDiscountLocation: "runtime",
    worstCondition: "READY missing",
    equityCurve: [0],
    replay: {
      mode: "runtime-replay",
      strategyId: "kod",
      windowDays: 30,
      scanEveryCandles: 4,
      availableDays: 30,
      startedAt: Date.UTC(2026, 5, 1),
      endedAt: Date.UTC(2026, 6, 1),
      scannedWindows: 100,
      readyAlerts: 0,
      watchAlerts: 12,
      triggeredTrades: 0,
      notTriggered: 0,
      openTrades: 0,
      stoppedTrades: 0,
      tp1Trades: 0,
      tp2Trades: 0,
      totalR: 0,
      expectancyR: 0,
      bySymbol: [{
        symbol: "GBPUSD",
        watchAlerts: 12,
        readyAlerts: 0,
        candidateAlerts: 12,
        triggeredTrades: 0,
        avgScore: 74,
        totalR: 0,
        winRate: 0
      }],
      calibration: [{
        label: "READY üretimi",
        value: "0",
        detail: "WATCH var ama READY yok.",
        verdict: "investigate"
      }],
      failureReasons: [],
      watchReasonSummary: [{ reason: "15m mum kapanış onayı bekleniyor.", count: 12 }],
      trades: [],
      candidates: [{
        id: "candidate-1",
        symbol: "GBPUSD",
        direction: "short",
        signalTime: Date.UTC(2026, 5, 20, 12),
        stage: "watch",
        grade: "A",
        score: 74,
        entry: 1.3281,
        stopLoss: 1.3293,
        target: 1.3214,
        rr: 4.6,
        entrySource: "mss-close",
        entryStatus: "pending",
        governance: "caution",
        actionWindow: "waiting",
        decision: "15m mum 1.3278 altında kapanmalı.",
        reasons: ["15m mum kapanış onayı bekleniyor."],
        tags: ["grade:A"]
      }]
    }
  };
}

describe("BacktestView replay visibility", () => {
  it("renders monthly watch candidates even when there are no ready trades", () => {
    const markup = renderToStaticMarkup(<BacktestView result={replayResult()} onRun={() => undefined} />);

    expect(markup).toContain("WATCH neden kaldı?");
    expect(markup).toContain("Aylık setup akışı");
    expect(markup).toContain("12 WATCH");
    expect(markup).toContain("GBPUSD SHORT");
    expect(markup).toContain("15m mum kapanış onayı bekleniyor.");
  });
});
