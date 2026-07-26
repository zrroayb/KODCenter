import { loadYahooMarketBatch } from "../src/lib/data/yahooProvider";
import { detectStructuralBias } from "../src/lib/intelligence/structuralBias";
import { buildMarketContext } from "../src/lib/intelligence/marketContext";
import { attachSmtDivergences } from "../src/lib/intelligence/smtEngine";
import { crtStrategy } from "../src/lib/strategies/crt/crt.strategy";
import { trendContinuationStrategy } from "../src/lib/strategies/trendContinuation/trendContinuation.strategy";

async function run() {
  const symbol = (process.argv[2] ?? "USDCHF") as never;
  const batch = await loadYahooMarketBatch([symbol], { baseUrl: "https://query2.finance.yahoo.com", fetcher: fetch, retryAttempts: 3 });
  const market = batch.markets[0];
  if (!market) throw new Error(`no ${symbol}: ` + batch.errors.join(" | "));
  const ctx = attachSmtDivergences([buildMarketContext(market.symbol, market.timeframes)])[0];

  const daily = detectStructuralBias(ctx.timeframes.daily);
  const h4 = detectStructuralBias(ctx.timeframes.h4);
  const h1 = detectStructuralBias(ctx.timeframes.h1);
  const lastClose = ctx.timeframes.h1.at(-1)?.close;

  const crt = crtStrategy.scan({ context: ctx, settings: crtStrategy.defaultSettings });
  const cont = trendContinuationStrategy.scan({ context: ctx, settings: trendContinuationStrategy.defaultSettings });

  console.log(JSON.stringify({
    lastClose,
    dealingRange: ctx.dealingRange,
    biasDaily: { bias: daily.bias, pattern: daily.pattern, conf: daily.confidence, lastEvent: daily.lastEvent, reasons: daily.reasons },
    biasH4: { bias: h4.bias, pattern: h4.pattern, lastEvent: h4.lastEvent },
    biasH1: { bias: h1.bias, pattern: h1.pattern, lastEvent: h1.lastEvent },
    crtSignals: crt.signals.map((s) => ({ dir: s.direction, stage: s.stage, grade: s.grade, score: s.score, rangeTf: s.crtAnchor?.rangeTf, rangeHigh: s.crtAnchor?.rangeHigh, rangeLow: s.crtAnchor?.rangeLow, blockers: s.governance.blockers.slice(0, 3), summary: s.decisionSummary.shortSummary })),
    contSignals: cont.signals.map((s) => ({ dir: s.direction, stage: s.stage, grade: s.grade, score: s.score, blockers: s.governance.blockers.slice(0, 4), summary: s.decisionSummary.shortSummary })),
    contRejected: cont.rejectedSetups
  }, null, 2));
}

run().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exitCode = 1; });
