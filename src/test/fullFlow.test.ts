import { describe, expect, it } from "vitest";
import { createDemoMarkets } from "../data/demoData";
import { waitingRequirements } from "../components/ScannerView";
import { runDemoBacktest } from "../lib/backtest/backtestEngine";
import { focusChartOnSignal, selectedSignalAnnotations, signalAnchorTime } from "../lib/charts/selectedSignal";
import { buildMarketContext } from "../lib/intelligence/marketContext";
import { attachSmtDivergences } from "../lib/intelligence/smtEngine";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";

describe("full tradebot flow", () => {
  it("turns market candles into scan output, chart focus, wait requirements, and backtest stats", () => {
    const markets = createDemoMarkets();
    const contexts = attachSmtDivergences(markets.map((market) => buildMarketContext(market.symbol, market.timeframes)));
    const scanResults = contexts.map((context) => kodStrategy.scan({ context, settings: kodStrategy.defaultSettings }));
    const signals = scanResults.flatMap((result) => result.signals);
    const best = [...signals].sort((a, b) => {
      const readyScore = (b.stage === "ready" ? 1000 : 0) - (a.stage === "ready" ? 1000 : 0);
      return readyScore || b.score - a.score;
    })[0];

    expect(markets).toHaveLength(12);
    expect(contexts).toHaveLength(12);
    expect(signals).toHaveLength(12);
    expect(best).toBeDefined();

    const focus = focusChartOnSignal(best);
    const anchor = signalAnchorTime(best);
    const annotations = selectedSignalAnnotations(best);
    const requirements = waitingRequirements(best);
    const backtest = runDemoBacktest(contexts);

    expect(focus.from).toBeLessThanOrEqual(anchor);
    expect(focus.to).toBeGreaterThanOrEqual(anchor);
    expect(annotations.sweep ?? annotations.displacement ?? annotations.marketStructureShift ?? annotations.fairValueGap).toBeDefined();
    expect(requirements.length).toBeGreaterThan(0);
    expect(backtest.totalTrades).toBeGreaterThanOrEqual(0);
    expect(backtest.equityCurve.length).toBe(backtest.totalTrades + 1);
  });
});
