// 1H anchor'ı GERÇEK veride yeniden ölç (owner talebi 2026-07-28). Replay 1H'yi headline'a sokmadan
// gölge "tracking" hattında ölçer (trackingTrades). Çekirdek (non-1H) ile yan yana raporlar.
// 2026-07-22 ölçümü: 1H -2.77R / PF 0.31 / %20 win iken çekirdek +2.89R. Değişti mi?
import { loadYahooMarketBatch, YAHOO_SYMBOLS } from "../src/lib/data/yahooProvider";
import { runMonthlyRuntimeReplay } from "../src/lib/backtest/runtimeReplay";
import { crtStrategy } from "../src/lib/strategies/crt/crt.strategy";
import type { RuntimeReplayTrade } from "../src/lib/analytics/performance";

function metrics(trades: RuntimeReplayTrade[]) {
  const t = trades.filter((x) => x.status !== "not-triggered" && x.status !== "open");
  const wins = t.filter((x) => x.rMultiple > 0), losses = t.filter((x) => x.rMultiple < 0);
  const totalR = t.reduce((s, x) => s + x.rMultiple, 0);
  const gw = wins.reduce((s, x) => s + x.rMultiple, 0), gl = Math.abs(losses.reduce((s, x) => s + x.rMultiple, 0));
  return { trades: t.length, totalR: +totalR.toFixed(2), expectancyR: t.length ? +(totalR / t.length).toFixed(2) : 0,
    winRatePct: t.length ? +((wins.length / t.length) * 100).toFixed(1) : 0, profitFactor: +(gl ? gw / gl : gw).toFixed(2) };
}
function chunks<T>(a: T[], n: number) { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

async function run() {
  const syms = YAHOO_SYMBOLS.map((s) => s.symbol); const markets = [];
  for (const g of chunks(syms, 4)) { const b = await loadYahooMarketBatch(g, { baseUrl: "https://query2.finance.yahoo.com", fetcher: fetch, retryAttempts: 3 }); markets.push(...b.markets); }
  for (const mode of ["prod", "sample"] as const) {
    const extra = mode === "sample" ? { minimumRR: 0.1, useExecutionCosts: false } : {};
    const r = runMonthlyRuntimeReplay({ markets, strategy: crtStrategy, settings: { ...crtStrategy.defaultSettings, ...extra }, windowDays: 60 });
    const core = metrics(r.replay?.trades ?? []);
    const oneH = metrics(r.replay?.trackingTrades ?? []);
    console.log(`\n[${mode}]  core (non-1H): ${JSON.stringify(core)}`);
    console.log(`         1H anchor    : ${JSON.stringify(oneH)}`);
  }
}
run().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exitCode = 1; });
