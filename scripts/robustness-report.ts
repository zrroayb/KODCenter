// Backtest sağlamlık raporu: replay'i GERÇEK veride koşar, gerçekleşen R serisini çıkarır ve
// (1) walk-forward dönem-kararlılığı, (2) Monte-Carlo bootstrap dağılımı, (3) en son kurulumun
// geçmişteki benzerlerinin sonucu — üçünü de basar. Harici bağımlılık yok; cloud-scan ile aynı veri
// yolu. Kullanım: npm run report:robustness   (opsiyonel: ROBUST_DAYS=90)
import { loadYahooMarketBatch, YAHOO_SYMBOLS } from "../src/lib/data/yahooProvider";
import { runMonthlyRuntimeReplay } from "../src/lib/backtest/runtimeReplay";
import { crtStrategy } from "../src/lib/strategies/crt/crt.strategy";
import { trendContinuationStrategy } from "../src/lib/strategies/trendContinuation/trendContinuation.strategy";
import type { StrategyModule } from "../src/lib/strategies/types";
import type { RuntimeReplayTrade } from "../src/lib/analytics/performance";
import { monteCarloAnalysis, walkForwardAnalysis } from "../src/lib/analytics/robustness";
import { similarSetupOutcome } from "../src/lib/analytics/setupSimilarity";

const windowDays = Number(process.env.ROBUST_DAYS ?? "90");
const RESOLVED = new Set(["tp1", "tp2", "stopped"]);

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function resolvedTrades(trades: RuntimeReplayTrade[]): RuntimeReplayTrade[] {
  return trades.filter((t) => RESOLVED.has(t.status)).sort((a, b) => a.signalTime - b.signalTime);
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

  console.log(`\nBacktest sağlamlık raporu · ${markets.length} sembol · pencere ${windowDays}g`);
  console.log("(örneklem ayarı: minRR 0.1, maliyet kapalı — istatistik için yeterli işlem)\n");

  for (const strategy of [crtStrategy, trendContinuationStrategy] as StrategyModule[]) {
    const result = runMonthlyRuntimeReplay({
      markets,
      strategy,
      settings: { ...strategy.defaultSettings, minimumRR: 0.1, useExecutionCosts: false },
      windowDays
    });
    const trades = resolvedTrades(result.replay?.trades ?? []);
    const rs = trades.map((t) => t.rMultiple);

    console.log(`━━ ${strategy.id} · ${rs.length} çözülmüş işlem · toplam ${rs.reduce((s, r) => s + r, 0).toFixed(1)}R ━━`);

    const wf = walkForwardAnalysis(rs, { folds: 5 });
    console.log(`  walk-forward: ${wf.summary}`);
    for (const f of wf.folds) {
      console.log(`     dilim ${f.index}: ${String(f.trades).padStart(3)} işlem  exp=${(f.expectancyR >= 0 ? "+" : "") + f.expectancyR.toFixed(2)}R  win=${f.winRatePct}%  PF=${f.profitFactor}`);
    }

    const mc = monteCarloAnalysis(rs, { runs: 5000, seed: 1, ruinThresholdR: -10 });
    console.log(`  monte-carlo:  ${mc.summary}`);

    if (trades.length >= 12) {
      // En son kurulumu "canlı sorgu" gibi al, ondan ÖNCEKİ kurulumlar arasından benzerini ara.
      const query = trades[trades.length - 1];
      const history = trades.slice(0, -1);
      const sim = similarSetupOutcome(history, query, 8);
      console.log(`  benzerlik demo (son kurulum ${query.symbol} ${query.direction}): ${sim.summary}`);
    }
    console.log("");
  }

  if (errors.length) console.log(`uyarılar: ${errors.join(" | ")}\n`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
