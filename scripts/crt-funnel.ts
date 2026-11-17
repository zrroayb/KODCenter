// CRT huni ölçümü (denetim 2026-11, docs/CRT_DENETIM_2026-11.md). SALT OKUR: motoru değiştirmez,
// replay'in kullandığı aynı zaman dilimleriyle (closed + forming HTF) her taramada TÜM anchor
// sinyallerini okur ve her kapıda kaç adayın elendiğini sayar:
//   raid → C2 içeride kapandı → reclaim → ChoCH → POI → C3'te retest (entry confirmed)
//   → key level → D/W/M yön → PD → RR → diğer blocker'lar → READY
// READY olan her benzersiz setup için iki sonuç ölçer:
//   - dolumdan (retest mumu) itibaren canlı kuralla (EQ'da BE, DOL hedef, stop) → "fill"
//   - replay'in yaptığı gibi tarama anından itibaren yeniden dokunuş bekleyerek → "replay"
// ve READY'leri kapı kombinasyonlarına göre kırar. Ayrıca yalnız D/W/M veya key level kapısına
// takılan (girişi dolmuş) setup'ları "kapı kapalı olsaydı" diye aynı kuralla ölçer.
//
// Kullanım:
//   npx tsx scripts/crt-funnel.ts --demo                 (sentetik demo veri)
//   npx tsx scripts/crt-funnel.ts --yahoo                (Yahoo/Binance; ağ gerekir — GitHub Actions)
//   npx tsx scripts/crt-funnel.ts --input markets.json   (DemoMarket[] JSON)
//   seçenekler: --days 30  --every 4  --out funnel.md  --json funnel.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPLAY_ARCHIVE_VERSION } from "../src/lib/backtest/replayArchive";
import { createDemoMarkets, type DemoMarket } from "../src/data/demoData";
import { __runtimeReplayInternals } from "../src/lib/backtest/runtimeReplay";
import { loadYahooMarketBatch, YAHOO_SYMBOLS } from "../src/lib/data/yahooProvider";
import type { Candle, MarketContext, TradingSignal } from "../src/lib/ict/types";
import { buildMarketContext } from "../src/lib/intelligence/marketContext";
import { attachSmtDivergences } from "../src/lib/intelligence/smtEngine";
import { crtStrategy } from "../src/lib/strategies/crt/crt.strategy";
import { CHOCH_FAILURE_LABEL, chochFailureReason, mergeReadyArchive, type ArchivedReady, DEPTH_GATES, depth, GATE_LABEL, gateFlags, type ChochFailure, type Gate } from "./crtFunnelGates";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const DAY = 24 * 60 * 60 * 1000;
const M15 = 15 * 60 * 1000;
const windowDays = Number(option("days") ?? 30);
const scanEvery = Math.max(1, Number(option("every") ?? 4));
// Variant flags (measurement only): ChoCH reference and window, plus the scan-grid phase. --shift N
// scans the candles N 15m bars later in the --every grid — that phase alone moved the result ~2.7R
// in the 2026-11-14 run, so every variant is measured at several phases.
const settings: Record<string, string | number | boolean> = {
  ...crtStrategy.defaultSettings,
  ...(option("choch-reference") ? { chochReference: option("choch-reference")! } : {}),
  ...(option("choch-window") ? { chochWindow: option("choch-window")! } : {})
};
const variant = option("variant") ?? "HEAD";
const shift = Math.max(0, Number(option("shift") ?? 0));
// Same numbers as crtChochOptions in the engine, computed here so this script also runs inside an
// older engine checkout (the V0 baseline) that does not export it.
const chochWindow = settings.chochWindow === "wide" ? { maxDelay: 24, freshness: 32 } : { maxDelay: 12, freshness: 16 };

function rangeCandles(context: MarketContext, rangeTf: string): Candle[] {
  if (rangeTf === "4h") return context.timeframes.h4;
  if (rangeTf === "1d") return context.timeframes.daily;
  if (rangeTf === "1w") return context.timeframes.weekly;
  return context.timeframes.monthly;
}

// C1 = latest range candle with the signal's high/low; C2 = first later candle sweeping it.
function cycleOf(context: MarketContext, signal: TradingSignal) {
  const anchor = signal.crtAnchor;
  if (!anchor) return undefined;
  const candles = rangeCandles(context, anchor.rangeTf);
  let c1 = -1;
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    if (Math.abs(candles[index].high - anchor.rangeHigh) < 1e-9 && Math.abs(candles[index].low - anchor.rangeLow) < 1e-9) { c1 = index; break; }
  }
  if (c1 < 0) return undefined;
  const c2 = candles.findIndex((candle, index) => index > c1 && (candle.high > anchor.rangeHigh || candle.low < anchor.rangeLow));
  if (c2 < 0) return undefined;
  return { adjacent: c2 === c1 + 1, c3Open: candles[c2 + 1]?.time };
}

type Outcome = { status: "tp2" | "breakeven" | "stopped" | "open" | "not-filled"; r: number };

// Live rule from the fill: EQ arms BE, DOL = full exit, stop first on a shared candle.
function outcomeFromFill(signal: TradingSignal, m15: Candle[], fillTime: number, maxCandles: number): Outcome {
  const { entry, stopLoss, targets, riskDistance } = signal.plan;
  const short = signal.direction === "short";
  const candles = m15.filter((candle) => candle.time >= fillTime).slice(0, maxCandles);
  const start = candles.findIndex((candle) => candle.low <= entry && candle.high >= entry);
  if (start < 0) return { status: "not-filled", r: 0 };
  let be = false;
  for (const candle of candles.slice(start)) {
    const stop = be ? entry : stopLoss;
    if (short ? candle.high >= stop : candle.low <= stop) return be ? { status: "breakeven", r: 0 } : { status: "stopped", r: -1 };
    if (short ? candle.low <= targets[1] : candle.high >= targets[1]) return { status: "tp2", r: Math.abs(targets[1] - entry) / riskDistance };
    if (short ? candle.low <= targets[0] : candle.high >= targets[0]) be = true;
  }
  const last = candles.at(-1)!;
  return { status: "open", r: Math.max(-1, (short ? entry - last.close : last.close - entry) / riskDistance) };
}

type SetupRecord = {
  key: string;
  symbol: string;
  rangeTf: string;
  direction: string;
  bestDepth: number;
  // Why the ChoCH gate stopped it (only when its deepest reach stopped at the ChoCH gate).
  chochReason?: ChochFailure;
  stoppedAt?: Gate;
  firstReady?: { time: number; signal: TradingSignal; context: MarketContext; flags: Record<Gate, boolean> };
  counterfactual?: { signal: TradingSignal; gates: string };
};

async function loadMarkets(): Promise<DemoMarket[]> {
  const input = option("input");
  if (input) return JSON.parse(readFileSync(input, "utf8")) as DemoMarket[];
  if (flag("yahoo")) {
    // Small sequential batches, like cloud-scan: Yahoo is more stable that way.
    const symbols = YAHOO_SYMBOLS.map((item) => item.symbol);
    const markets: DemoMarket[] = [];
    const errors: string[] = [];
    for (let index = 0; index < symbols.length; index += 4) {
      const batch = await loadYahooMarketBatch(symbols.slice(index, index + 4), {
        baseUrl: "https://query2.finance.yahoo.com", fetcher: fetch, retryAttempts: 3
      });
      markets.push(...batch.markets);
      errors.push(...batch.errors);
    }
    if (errors.length) console.error(`Veri hataları: ${errors.join(" | ")}`);
    if (!markets.length) throw new Error("Yahoo/Binance hiç veri döndürmedi.");
    if (option("save")) writeFileSync(option("save")!, JSON.stringify(markets));
    return markets;
  }
  return createDemoMarkets();
}

function pct(part: number, total: number) {
  return total ? `${((part / total) * 100).toFixed(0)}%` : "—";
}

async function main() {
  const markets = await loadMarkets();
  const end = Math.max(...markets.map((market) => market.timeframes.m15.at(-1)?.time ?? 0)) + M15;
  const first = Math.min(...markets.map((market) => market.timeframes.m15[0]?.time ?? end));
  const start = Math.max(first, end - windowDays * DAY);
  const times = Array.from(new Set(markets.flatMap((market) => market.timeframes.m15.filter((candle) => candle.time >= start).map((candle) => candle.time + M15))))
    .sort((a, b) => a - b)
    .filter((_, index, all) => index % scanEvery === shift % scanEvery || index === all.length - 1);

  const setups = new Map<string, SetupRecord>();
  const perScan = Object.fromEntries(DEPTH_GATES.map((gate) => [gate, 0])) as Record<Gate, number>;
  let scanSignals = 0;
  for (const time of times) {
    const contexts = attachSmtDivergences(markets
      .map((market) => ({ market, timeframes: __runtimeReplayInternals.timeframesAt(market, time) }))
      .filter(({ timeframes }) => timeframes.m15.length >= 80 && timeframes.h1.length >= 30 && timeframes.h4.length >= 12 && timeframes.daily.length >= 20 && timeframes.weekly.length >= 3)
      .map(({ market, timeframes }) => buildMarketContext(market.symbol, timeframes)));
    for (const context of contexts) {
      for (const signal of crtStrategy.scan({ context, settings }).signals) {
        const anchor = signal.crtAnchor;
        if (!anchor) continue;
        scanSignals += 1;
        const flags = gateFlags(signal);
        const reached = depth(flags);
        DEPTH_GATES.slice(0, reached).forEach((gate) => { perScan[gate] += 1; });
        const key = `${signal.symbol}|${anchor.rangeTf}|${signal.direction}|${anchor.rangeHigh}|${anchor.rangeLow}`;
        const record = setups.get(key) ?? { key, symbol: signal.symbol, rangeTf: anchor.rangeTf, direction: signal.direction, bestDepth: -1 };
        if (reached > record.bestDepth) {
          record.bestDepth = reached;
          record.stoppedAt = DEPTH_GATES[reached];
          record.chochReason = record.stoppedAt === "choch" ? chochFailureReason(signal, chochWindow) : undefined;
        }
        if (flags.ready && !record.firstReady) record.firstReady = { time, signal, context, flags };
        // Counterfactual: entry filled and the ONLY blockers are D/W/M direction and/or key level.
        if (!flags.ready && flags.entry && !record.counterfactual && signal.stage !== "missed" && signal.stage !== "invalidated") {
          const only = signal.governance.blockers.every((item) => /HTF yönü|Key level yok/.test(item));
          if (only && signal.governance.blockers.length) {
            record.counterfactual = { signal, gates: signal.governance.blockers.map((item) => (/HTF/.test(item) ? "D/W/M" : "key level")).join("+") };
          }
        }
        setups.set(key, record);
      }
    }
  }

  const all = [...setups.values()];
  const lines: string[] = [];
  lines.push(`# CRT huni ölçümü — ${variant} (shift ${shift})`, "");
  lines.push(`Ayarlar: chochReference=${String(settings.chochReference ?? "motor varsayılanı")} · chochWindow=${String(settings.chochWindow ?? "motor varsayılanı")} (pencere ${chochWindow.maxDelay} mum, tazelik ${chochWindow.freshness} mum) · motor sürümü ${REPLAY_ARCHIVE_VERSION}.`, "");
  lines.push(`Veri: ${option("input") ? option("input") : flag("yahoo") ? "Yahoo/Binance (canlı)" : "demo (sentetik)"} · ${markets.length} sembol · pencere ${((end - start) / DAY).toFixed(1)} gün · ${times.length} tarama (her ${scanEvery} m15) · ${scanSignals} sinyal okuması · ${all.length} benzersiz setup.`, "");
  lines.push("## Huni (benzersiz setup'ın ulaştığı en derin kapı)", "", "| Kapı | Geçen setup | Önceki kapıya göre | Tarama okuması |", "|---|---|---|---|");
  let previous = all.length;
  for (const [index, gate] of DEPTH_GATES.entries()) {
    const passed = all.filter((record) => record.bestDepth > index).length;
    lines.push(`| ${GATE_LABEL[gate]} | ${passed} | ${pct(passed, previous)} | ${perScan[gate]} |`);
    previous = passed;
  }
  lines.push("", "## Setup'lar nerede takıldı", "", "| Kapı | Setup |", "|---|---|");
  for (const gate of DEPTH_GATES) {
    const count = all.filter((record) => record.stoppedAt === gate).length;
    if (count) lines.push(`| ${GATE_LABEL[gate]} | ${count} |`);
  }
  const byTf = new Map<string, { total: number; ready: number }>();
  for (const record of all) {
    const item = byTf.get(record.rangeTf) ?? { total: 0, ready: 0 };
    item.total += 1;
    if (record.firstReady) item.ready += 1;
    byTf.set(record.rangeTf, item);
  }
  const chochStopped = all.filter((record) => record.stoppedAt === "choch");
  if (chochStopped.length) {
    lines.push("", "## ChoCH kapısında takılanlar — neden (yaklaşık teşhis)", "", "| Neden | Setup |", "|---|---|");
    for (const reason of Object.keys(CHOCH_FAILURE_LABEL) as ChochFailure[]) {
      const count = chochStopped.filter((record) => record.chochReason === reason).length;
      if (count) lines.push(`| ${CHOCH_FAILURE_LABEL[reason]} | ${count} |`);
    }
  }
  lines.push("", "## Anchor bazında", "", "| Range TF | Setup | READY |", "|---|---|---|");
  for (const [tf, item] of byTf) lines.push(`| ${tf} | ${item.total} | ${item.ready} |`);

  const market = (symbol: string) => markets.find((item) => item.symbol === symbol)!;
  type ReadyRow = { record: SetupRecord; fill: Outcome; replay: string; replayR: number; tags: Record<string, string> };
  const readyRows: ReadyRow[] = [];
  for (const record of all.filter((item) => item.firstReady)) {
    const { signal, time, context } = record.firstReady!;
    const fillTime = signal.evidence.find((item) => item.id === "entry")?.time ?? time;
    const factor = signal.crtAnchor?.confirmTf === "1d" ? 96 : signal.crtAnchor?.confirmTf === "4h" ? 16 : signal.crtAnchor?.confirmTf === "1h" ? 4 : 1;
    const m15 = market(record.symbol).timeframes.m15;
    const fill = outcomeFromFill(signal, m15, fillTime, 96 * factor);
    const replay = __runtimeReplayInternals.evaluateForwardOutcome(signal, m15.filter((candle) => candle.time >= time).slice(0, 96 * factor), [], settings);
    const cycle = cycleOf(context, signal);
    const choch = signal.evidence.find((item) => item.id === "choch");
    const strong = Number(choch?.metadata?.bodyRatio ?? 0) >= 0.5 && Number(choch?.metadata?.rangeAtr ?? 0) >= 0.8;
    const fillCandle = m15.find((candle) => candle.time >= fillTime);
    const priceTraded = fillCandle ? fillCandle.low <= signal.plan.entry && fillCandle.high >= signal.plan.entry : false;
    const reaction = fillCandle ? (signal.direction === "short" ? fillCandle.close < signal.plan.entry : fillCandle.close > signal.plan.entry) : false;
    readyRows.push({
      record, fill, replay: replay.status, replayR: replay.rMultiple,
      tags: {
        "ChoCH zamanı": !cycle?.c3Open || typeof choch?.time !== "number" ? "bilinmiyor" : choch.time < cycle.c3Open ? "C2 içinde" : "C3 içinde",
        "C1-C2": cycle ? (cycle.adjacent ? "bitişik" : "bitişik değil") : "bilinmiyor",
        "ChoCH gücü": strong ? "güçlü kapanış" : "FVG ile terfi",
        "Giriş fiyatı işlem gördü mü": priceTraded ? "evet" : "hayır (yalnız bölgeye dokunuş)",
        "Dolum mumu tepkisi": reaction ? "kapanış giriş lehine" : "kapanış giriş aleyhine",
        "D/W/M": signal.evidence.find((item) => item.id === "htf-alignment")?.status === "pass" ? "tam uyum" : "kısmi",
        "Grade": signal.grade,
        "Anchor (range TF)": signal.crtAnchor?.rangeTf ?? "bilinmiyor"
      }
    });
  }
  const summarize = (rows: Outcome[]) => {
    const filled = rows.filter((row) => row.status !== "not-filled");
    const total = filled.reduce((sum, row) => sum + row.r, 0);
    return `${rows.length} setup · dolan ${filled.length} · tp2 ${filled.filter((row) => row.status === "tp2").length} / BE ${filled.filter((row) => row.status === "breakeven").length} / stop ${filled.filter((row) => row.status === "stopped").length} / açık ${filled.filter((row) => row.status === "open").length} · toplam ${total.toFixed(2)}R · ortalama ${filled.length ? (total / filled.length).toFixed(2) : "—"}R`;
  };
  lines.push("", "## READY sonuçları", "");
  if (!readyRows.length) {
    lines.push("Bu veride READY yok — sonuç ölçülemedi.");
  } else {
    lines.push(`- Dolumdan itibaren (canlı kural): ${summarize(readyRows.map((row) => row.fill))}`);
    const replayCounts = readyRows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.replay]: (acc[row.replay] ?? 0) + 1 }), {});
    lines.push(`- Replay yöntemiyle (taramadan sonra yeniden dokunuş): ${Object.entries(replayCounts).map(([status, count]) => `${status} ${count}`).join(" · ")} · toplam ${readyRows.reduce((sum, row) => sum + row.replayR, 0).toFixed(2)}R`);
    const tagNames = Object.keys(readyRows[0].tags);
    for (const tag of tagNames) {
      lines.push("", `### ${tag}`, "");
      for (const value of Array.from(new Set(readyRows.map((row) => row.tags[tag])))) {
        lines.push(`- ${value}: ${summarize(readyRows.filter((row) => row.tags[tag] === value).map((row) => row.fill))}`);
      }
    }
    if (readyRows.length < 30) lines.push("", `> Örnek küçük (${readyRows.length} READY < 30): bu kırılımlar karar için yeterli DEĞİL.`);
  }
  const counterfactual = all.filter((record) => record.counterfactual && !record.firstReady);
  lines.push("", "## Kapı kapalı olsaydı (yalnız D/W/M ve/veya key level'a takılan, girişi dolmuş setup'lar)", "");
  if (!counterfactual.length) {
    lines.push("Yok.");
  } else {
    for (const gates of Array.from(new Set(counterfactual.map((record) => record.counterfactual!.gates)))) {
      const rows = counterfactual.filter((record) => record.counterfactual!.gates === gates).map((record) => {
        const signal = record.counterfactual!.signal;
        const fillTime = signal.evidence.find((item) => item.id === "entry")?.time ?? 0;
        return outcomeFromFill(signal, market(record.symbol).timeframes.m15, fillTime, 96 * 16);
      });
      lines.push(`- Takıldığı kapı ${gates}: ${summarize(rows)}`);
    }
  }
  const report = lines.join("\n");
  console.log(report);
  if (option("out")) writeFileSync(option("out")!, report);
  const filled = readyRows.filter((row) => row.fill.status !== "not-filled");
  const summary = {
    variant,
    shift,
    setups: all.length,
    choch: all.filter((record) => record.bestDepth > DEPTH_GATES.indexOf("choch")).length,
    ready: readyRows.length,
    filled: filled.length,
    totalR: Number(filled.reduce((sum, row) => sum + row.fill.r, 0).toFixed(2))
  };
  const archiveDir = option("archive-dir");
  if (archiveDir) {
    // One file per engine version: a rule change starts a new sample (never mixed).
    mkdirSync(archiveDir, { recursive: true });
    const path = join(archiveDir, `ready-${REPLAY_ARCHIVE_VERSION}-${variant}.json`);
    const existing = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as ArchivedReady[] : [];
    const incoming: ArchivedReady[] = readyRows.map((row) => ({
      key: `${row.record.key}|${variant}`,
      variant,
      symbol: row.record.symbol,
      rangeTf: row.record.rangeTf,
      direction: row.record.direction,
      firstSeen: row.record.firstReady!.time,
      status: row.fill.status,
      r: Number(row.fill.r.toFixed(2)),
      tags: row.tags
    }));
    const merged = mergeReadyArchive(existing, incoming);
    writeFileSync(path, JSON.stringify(merged, null, 2));
    const resolved = merged.filter((record) => record.status === "tp2" || record.status === "breakeven" || record.status === "stopped");
    const archiveR = resolved.reduce((sum, record) => sum + record.r, 0);
    const lines2 = ["", `## Birikimli arşiv (${variant}, ${REPLAY_ARCHIVE_VERSION})`, "",
      `- Arşivde ${merged.length} READY; sonuçlanan ${resolved.length}, toplam ${archiveR.toFixed(2)}R, ortalama ${resolved.length ? (archiveR / resolved.length).toFixed(2) : "—"}R.`,
      `- 30 sonuçlanmış işleme ${Math.max(0, 30 - resolved.length)} kaldı.`];
    if (resolved.length) {
      for (const tag of ["ChoCH zamanı", "C1-C2", "Grade", "Anchor (range TF)"]) {
        lines2.push("", `### Arşiv — ${tag} (kural değil, yalnız ölçüm)`, "");
        for (const value of Array.from(new Set(resolved.map((record) => record.tags[tag] ?? "bilinmiyor")))) {
          const group = resolved.filter((record) => (record.tags[tag] ?? "bilinmiyor") === value);
          const total = group.reduce((sum, record) => sum + record.r, 0);
          lines2.push(`- ${value}: ${group.length} işlem · toplam ${total.toFixed(2)}R · ortalama ${(total / group.length).toFixed(2)}R`);
        }
      }
    }
    console.log(lines2.join("\n"));
    if (option("out")) writeFileSync(option("out")!, report + "\n" + lines2.join("\n"));
  }
  if (option("summary")) writeFileSync(option("summary")!, JSON.stringify(summary));
  if (option("json")) {
    writeFileSync(option("json")!, JSON.stringify({
      summary,
      setups: all.map(({ firstReady, counterfactual: cf, ...rest }) => ({ ...rest, ready: Boolean(firstReady), counterfactualGates: cf?.gates })),
      ready: readyRows.map((row) => ({ key: row.record.key, fill: row.fill, replay: row.replay, replayR: row.replayR, tags: row.tags }))
    }, null, 2));
  }
}

const invokedDirectly = process.argv[1]?.endsWith("crt-funnel.ts");
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
