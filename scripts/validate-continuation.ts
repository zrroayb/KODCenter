// Trend Continuation çok-eksenli doğrulama (governance: tek 60g pass yeterli değil).
// Veri sınırı m15 ~30-60g olduğundan iki BAĞIMSIZ eksende doğrularız:
//   (1) Sembol-bazında = cross-sectional out-of-sample (12 ayrı market; edge çoğunda tutuyor mu?)
//   (2) Zaman-bölmeli = in-sample (eski yarı) vs out-of-sample (yeni yarı); edge iki yarıda da var mı?
// Tek replay koşulur; sonuç trade'leri signalTime ve symbol'e göre bölünür. Eşikler replay ile aynı
// (MIN 12 trade; edge: expectancy>=0.15 & PF>=1.15; avoid: expectancy<=-0.15 | PF<0.9).
import { loadYahooMarketBatch, YAHOO_SYMBOLS } from "../src/lib/data/yahooProvider";
import { runMonthlyRuntimeReplay } from "../src/lib/backtest/runtimeReplay";
import { trendContinuationStrategy } from "../src/lib/strategies/trendContinuation/trendContinuation.strategy";
import type { RuntimeReplayTrade } from "../src/lib/analytics/performance";

const MIN = 12;
const r2 = (n: number) => Number(n.toFixed(2));

function metrics(trades: RuntimeReplayTrade[]) {
  const triggered = trades.filter((t) => t.status !== "not-triggered" && t.status !== "open");
  const wins = triggered.filter((t) => t.rMultiple > 0);
  const losses = triggered.filter((t) => t.rMultiple < 0);
  const totalR = triggered.reduce((s, t) => s + t.rMultiple, 0);
  const grossWin = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.rMultiple, 0));
  const expectancyR = triggered.length ? totalR / triggered.length : 0;
  const profitFactor = grossLoss ? grossWin / grossLoss : grossWin;
  const verdict = triggered.length < MIN
    ? "needs-data"
    : expectancyR <= -0.15 || profitFactor < 0.9
      ? "avoid"
      : expectancyR >= 0.15 && profitFactor >= 1.15
        ? "edge"
        : "neutral";
  return { trades: triggered.length, totalR: r2(totalR), expectancyR: r2(expectancyR), winRatePct: r2(triggered.length ? (wins.length / triggered.length) * 100 : 0), profitFactor: r2(profitFactor), verdict };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function run() {
  const symbols = YAHOO_SYMBOLS.map((s) => s.symbol);
  const markets = [];
  const errors: string[] = [];
  for (const group of chunks(symbols, 4)) {
    const batch = await loadYahooMarketBatch(group, { baseUrl: "https://query2.finance.yahoo.com", fetcher: fetch, retryAttempts: 3 });
    markets.push(...batch.markets); errors.push(...batch.errors);
  }
  if (!markets.length) throw new Error(errors.join(" | ") || "no markets");

  const result = runMonthlyRuntimeReplay({ markets, strategy: trendContinuationStrategy, settings: trendContinuationStrategy.defaultSettings, windowDays: 60 });
  const trades = (result.replay?.trades ?? []).filter((t) => t.status !== "not-triggered" && t.status !== "open");

  // (2) Zaman bölmesi: signalTime medyanında IS (eski) vs OOS (yeni).
  const sorted = [...trades].sort((a, b) => a.signalTime - b.signalTime);
  const mid = Math.floor(sorted.length / 2);
  const inSample = sorted.slice(0, mid);
  const outSample = sorted.slice(mid);
  const splitTime = sorted[mid]?.signalTime;

  // (1) Sembol bazında.
  const bySymbol: Record<string, RuntimeReplayTrade[]> = {};
  for (const t of trades) (bySymbol[t.symbol] ??= []).push(t);
  const perSymbol = Object.entries(bySymbol)
    .map(([symbol, ts]) => ({ symbol, ...metrics(ts) }))
    .sort((a, b) => b.totalR - a.totalR);
  const symbolsPositive = perSymbol.filter((s) => s.trades >= 3 && s.expectancyR > 0).length;
  const symbolsWithSample = perSymbol.filter((s) => s.trades >= 3).length;

  console.log(JSON.stringify({
    markets: markets.length,
    windowDays: 60,
    settings: "prod (minRR 1.5 + costs)",
    overall: metrics(trades),
    timeSplit: {
      splitAt: splitTime ? new Date(splitTime).toISOString().slice(0, 10) : null,
      inSample: metrics(inSample),
      outOfSample: metrics(outSample)
    },
    crossSectional: {
      symbolsWithSample,
      symbolsPositive,
      perSymbol
    }
  }, null, 2));
}

run().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exitCode = 1; });
