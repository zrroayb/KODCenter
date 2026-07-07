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
      liveReadyEntries: 0,
      watchPromotedEntries: 0,
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
      filterScenarios: [{
        id: "live-ready",
        label: "Sadece canlı READY",
        description: "WATCH sonradan entry gibi sayılmadan.",
        sample: 0,
        triggered: 0,
        wins: 0,
        losses: 0,
        totalR: 0,
        expectancyR: 0,
        winRate: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        verdict: "needs-data"
      }],
      managementScenarios: [{
        id: "model",
        label: "Mevcut model",
        description: "EQ'da %50 partial + %50 DOL'a, +1R sonrası stop BE.",
        trades: 0,
        totalR: 0,
        expectancyR: 0,
        profitFactor: 0,
        deltaR: 0,
        verdict: "needs-data"
      }],
      calibration: [{
        label: "READY üretimi",
        value: "0",
        detail: "WATCH var ama READY yok.",
        verdict: "investigate"
      }],
      setupBreakdowns: [{
        key: "entry:mss-close",
        label: "Entry mss-close",
        sample: 4,
        triggered: 4,
        wins: 1,
        losses: 3,
        stopped: 3,
        totalR: -2,
        expectancyR: -0.5,
        winRate: 25,
        avgMfeR: 0.4,
        avgMaeR: -0.8,
        verdict: "avoid",
        note: "Bu koşul altında setuplar negatife dönmüş."
      }],
      failureCases: [],
      failureReasons: [],
      watchReasonSummary: [{ reason: "15m mum kapanış onayı bekleniyor.", count: 12 }],
      replayDiagnosis: ["Replay'in çoğu WATCH; canlı READY gibi okunmamalı."],
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
    expect(markup).toContain("AI replay yorumu");
    expect(markup).toContain("Filtre denemesi");
    expect(markup).toContain("Sadece canlı READY");
    expect(markup).toContain("Setup kırılımı");
    expect(markup).toContain("12 WATCH");
    expect(markup).toContain("GBPUSD SHORT");
    expect(markup).toContain("15m mum kapanış onayı bekleniyor.");
  });
});
