// Trend Continuation'ı GERÇEK veride ölç (governance: measure-before-promote, 30-trade kuralı).
// cloud-scan ile aynı veri yolu: Yahoo query2 direct + Binance direct (crypto). runMonthlyRuntimeReplay
// her iki playbook'u da walk-forward koşar; continuation tek-hedefli, generic forward-outcome yolu.
import { loadYahooMarketBatch, YAHOO_SYMBOLS } from "../src/lib/data/yahooProvider";
import { runMonthlyRuntimeReplay } from "../src/lib/backtest/runtimeReplay";
import { crtStrategy } from "../src/lib/strategies/crt/crt.strategy";
import { trendContinuationStrategy } from "../src/lib/strategies/trendContinuation/trendContinuation.strategy";
import type { StrategyModule } from "../src/lib/strategies/types";
import type { BacktestResult } from "../src/lib/analytics/performance";

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function line(strategy: StrategyModule, result: BacktestResult) {
  const r = result.replay;
  return {
    playbook: strategy.id,
    triggeredTrades: r?.triggeredTrades ?? result.totalTrades,
    totalR: r?.totalR ?? null,
    expectancyR: r ? Number((r.totalR / Math.max(1, r.triggeredTrades)).toFixed(2)) : null,
    winRatePct: Number(result.winRate.toFixed(1)),
    profitFactor: Number(result.profitFactor.toFixed(2)),
    avgRR: Number(result.averageRR.toFixed(2)),
    maxDrawdownR: Number(result.maxDrawdown.toFixed(2)),
    readyAlerts: r?.readyAlerts ?? null,
    watchAlerts: r?.watchAlerts ?? null,
    bestSymbol: result.bestSymbol
  };
}

async function run() {
  const symbols = YAHOO_SYMBOLS.map((item) => item.symbol);
  const markets = [];
  const errors: string[] = [];
  for (const group of chunks(symbols, 4)) {
    const batch = await loadYahooMarketBatch(group, {
      baseUrl: "https://query2.finance.yahoo.com",
      fetcher: fetch,
      retryAttempts: 3
    });
    markets.push(...batch.markets);
    errors.push(...batch.errors);
  }
  if (!markets.length) throw new Error(errors.join(" | ") || "no markets");

  const depth = markets.map((m) => ({ s: m.symbol, m15: m.timeframes.m15.length, h1: m.timeframes.h1.length, daily: m.timeframes.daily.length }));

  // İki ayarla ölçüyoruz:
  //  - "prod": canlı botun ayarı (minRR varsayılan + maliyet açık). Kaç READY gerçekten çıkıyor?
  //  - "sample": test kalibrasyon ayarı (minRR 0.1, maliyet kapalı) → istatistik için örneklem.
  const runs: Array<{ mode: string; settingsExtra: Record<string, number | string | boolean> }> = [
    { mode: "prod", settingsExtra: {} },
    { mode: "sample", settingsExtra: { minimumRR: 0.1, useExecutionCosts: false } }
  ];
  const out: Record<string, unknown>[] = [];
  for (const run of runs) {
    for (const strategy of [crtStrategy, trendContinuationStrategy] as StrategyModule[]) {
      const result = runMonthlyRuntimeReplay({
        markets,
        strategy,
        settings: { ...strategy.defaultSettings, ...run.settingsExtra },
        windowDays: 60
      });
      out.push({ mode: run.mode, ...line(strategy, result) });
    }
  }

  console.log(JSON.stringify({
    markets: markets.length,
    errors,
    dataDepth: depth,
    minTradesForVerdict: 12,
    results: out
  }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
