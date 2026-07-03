import type { DemoMarket } from "../../data/demoData";
import {
  equityCurveFromReturns,
  maxDrawdown,
  type BacktestResult,
  type RuntimeReplayCalibration,
  type RuntimeReplayOutcomeReason,
  type RuntimeReplayTrade
} from "../analytics/performance";
import { aggregateCandles, trimCandles } from "../data/candleAggregation";
import { executableHigh, executableLow } from "../data/bidAsk";
import type { Candle, MarketContext, MarketSymbol, TradingSignal } from "../ict/types";
import { buildMarketContext, type MarketTimeframes } from "../intelligence/marketContext";
import { attachSmtDivergences } from "../intelligence/smtEngine";
import type { StrategyModule, StrategySettings } from "../strategies/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_MAX_HOLD_CANDLES = 96;
const DEFAULT_SCAN_EVERY_CANDLES = 4;
const SETUP_COOLDOWN_MS = 6 * 60 * 60 * 1000;

type SetupState = {
  lastSeen: number;
  countedWatch: boolean;
  countedReady: boolean;
};

type ReplayOutcome = Pick<RuntimeReplayTrade, "status" | "rMultiple" | "maxFavorableR" | "maxAdverseR" | "candlesHeld" | "outcomeReason" | "tags" | "note">;

export type RuntimeReplayInput = {
  markets: DemoMarket[];
  strategy: StrategyModule;
  settings: StrategySettings;
  windowDays?: number;
  maxHoldCandles?: number;
  scanEveryCandles?: number;
};

function executionCandles(market: DemoMarket): Candle[] {
  return market.timeframes.m15.length ? market.timeframes.m15 : market.timeframes.m5;
}

function latestReplayTime(markets: DemoMarket[]): number {
  return Math.max(...markets.flatMap((market) => executionCandles(market).slice(-1).map((candle) => candle.time)), 0);
}

function earliestReplayTime(markets: DemoMarket[]): number {
  const firstTimes = markets.flatMap((market) => executionCandles(market).slice(0, 1).map((candle) => candle.time));
  return firstTimes.length ? Math.min(...firstTimes) : 0;
}

function sliceByTime(candles: Candle[], time: number, count: number): Candle[] {
  return trimCandles(candles.filter((candle) => candle.time <= time), count);
}

function timeframesAt(market: DemoMarket, time: number): MarketTimeframes {
  const m15 = sliceByTime(market.timeframes.m15, time, 220);
  const h1 = sliceByTime(market.timeframes.h1, time, 180);
  const h4 = sliceByTime(market.timeframes.h4, time, 140);
  const daily = sliceByTime(market.timeframes.daily, time, 220);
  const m5 = sliceByTime(market.timeframes.m5, time, 220);
  return {
    daily,
    h4: h4.length ? h4 : trimCandles(aggregateCandles(h1, "4h"), 140),
    h1: h1.length ? h1 : trimCandles(aggregateCandles(m15, "1h"), 180),
    m15,
    m5
  };
}

function enoughWarmup(context: MarketContext): boolean {
  return context.timeframes.m15.length >= 80 && context.timeframes.h1.length >= 30 && context.timeframes.h4.length >= 12 && context.timeframes.daily.length >= 20;
}

function enoughWarmupTimeframes(timeframes: MarketTimeframes): boolean {
  return timeframes.m15.length >= 80 && timeframes.h1.length >= 30 && timeframes.h4.length >= 12 && timeframes.daily.length >= 20;
}

function replayTimes(markets: DemoMarket[], startedAt: number, endedAt: number, scanEveryCandles: number): number[] {
  const allTimes = Array.from(new Set(
    markets.flatMap((market) =>
      executionCandles(market)
        .filter((candle) => candle.time >= startedAt && candle.time <= endedAt)
        .map((candle) => candle.time)
    )
  )).sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(scanEveryCandles));
  return allTimes.filter((_, index) => index % step === 0 || index === allTimes.length - 1);
}

function roundedLevel(value: number, symbol: MarketSymbol): string {
  const decimals = symbol === "EURUSD" || symbol === "GBPUSD" ? 5 : symbol === "BTCUSD" || symbol === "NAS100" ? 1 : 2;
  return value.toFixed(decimals);
}

function setupKey(signal: TradingSignal): string {
  return [
    signal.symbol,
    signal.direction,
    signal.plan.entrySource,
    roundedLevel(signal.plan.entry, signal.symbol),
    roundedLevel(signal.plan.stopLoss, signal.symbol),
    roundedLevel(signal.plan.targets[0] ?? signal.plan.entry, signal.symbol)
  ].join("|");
}

function futureCandlesForSignal(market: DemoMarket, signalTime: number, maxHoldCandles: number): Candle[] {
  return executionCandles(market)
    .filter((candle) => candle.time > signalTime)
    .slice(0, maxHoldCandles);
}

function priceTouched(candle: Candle, level: number): boolean {
  return candle.low <= level && candle.high >= level;
}

function rAtPrice(signal: TradingSignal, price: number): number {
  const risk = Math.max(signal.plan.riskDistance, 0.000001);
  return signal.direction === "short"
    ? (signal.plan.entry - price) / risk
    : (price - signal.plan.entry) / risk;
}

function targetR(signal: TradingSignal, targetIndex: 0 | 1): number {
  const target = signal.plan.targets[targetIndex] ?? signal.plan.targets[0] ?? signal.plan.entry;
  return Math.max(0, Math.abs(target - signal.plan.entry) / Math.max(signal.plan.riskDistance, 0.000001));
}

function expectedBias(signal: TradingSignal) {
  return signal.direction === "short" ? "bearish" : "bullish";
}

function expectedPd(signal: TradingSignal) {
  return signal.direction === "short" ? "premium" : "discount";
}

function tradeTags(signal: TradingSignal): string[] {
  const activeSession = signal.context.killzones.find((zone) => zone.active)?.name ?? "Outside";
  const expected = expectedBias(signal);
  return Array.from(new Set([
    `grade:${signal.grade}`,
    `entry:${signal.plan.entrySource}`,
    `entry-status:${signal.plan.entryStatus}`,
    `stop:${signal.plan.stopSource}`,
    `target:${signal.plan.targetSource}`,
    `session:${activeSession}`,
    `pd:${signal.context.premiumDiscount.zone}`,
    `regime:${signal.context.regime.type}`,
    `event:${signal.context.eventRisk.level}`,
    signal.context.smtDivergences.some((item) => item.direction === signal.direction) ? "smt:aligned" : "smt:none",
    signal.context.premiumDiscount.zone === expectedPd(signal) ? "pd:aligned" : "pd:mismatch",
    signal.context.bias.daily === expected || signal.context.bias.h4 === expected ? "htf:aligned" : "htf:conflict",
    signal.plan.rr >= 2 ? "rr:2plus" : signal.plan.rr >= 1.5 ? "rr:ok" : "rr:low",
    signal.governance.status === "allow" ? "governance:allow" : `governance:${signal.governance.status}`
  ]));
}

function stoppedReason(signal: TradingSignal, maxFavorableR: number): RuntimeReplayOutcomeReason {
  if (signal.context.eventRisk.level !== "clear") return "event-risk";
  if (signal.context.regime.tradeability !== "good" || signal.context.regime.type === "chop" || signal.context.regime.type === "news-expansion") return "range-chop";
  if (signal.context.bias.daily !== expectedBias(signal) && signal.context.bias.h4 !== expectedBias(signal)) return "htf-conflict";
  if (signal.plan.stopSource === "volatility-floor" || maxFavorableR < 0.25) return "stop-too-tight";
  return "unknown";
}

function evaluateForwardOutcome(signal: TradingSignal, futureCandles: Candle[]): ReplayOutcome {
  const tags = tradeTags(signal);
  if (!futureCandles.length) {
    return { status: "open", rMultiple: 0, maxFavorableR: 0, maxAdverseR: 0, candlesHeld: 0, outcomeReason: "expired", tags, note: "İleri mum yok; sonuç açık kaldı." };
  }

  const immediateEntry = signal.plan.entryStatus === "confirmed";
  const entryIndex = immediateEntry ? 0 : futureCandles.findIndex((candle) => priceTouched(candle, signal.plan.entry));
  if (entryIndex < 0) {
    return {
      status: "not-triggered",
      rMultiple: 0,
      maxFavorableR: 0,
      maxAdverseR: 0,
      candlesHeld: futureCandles.length,
      outcomeReason: "entry-not-filled",
      tags,
      note: "Entry alanı sonraki mumlarda tetiklenmedi."
    };
  }

  let maxFavorableR = 0;
  let maxAdverseR = 0;
  const afterEntry = futureCandles.slice(entryIndex);
  for (let index = 0; index < afterEntry.length; index += 1) {
    const candle = afterEntry[index];
    const highR = rAtPrice(signal, executableHigh(candle, signal.direction === "short" ? "buy" : "sell"));
    const lowR = rAtPrice(signal, executableLow(candle, signal.direction === "short" ? "buy" : "sell"));
    maxFavorableR = Math.max(maxFavorableR, highR, lowR);
    maxAdverseR = Math.min(maxAdverseR, highR, lowR);

    const stopHit = signal.direction === "short"
      ? executableHigh(candle, "buy") >= signal.plan.stopLoss
      : executableLow(candle, "sell") <= signal.plan.stopLoss;
    const tp2Hit = typeof signal.plan.targets[1] === "number" && (signal.direction === "short"
      ? executableLow(candle, "buy") <= signal.plan.targets[1]
      : executableHigh(candle, "sell") >= signal.plan.targets[1]);
    const tp1Hit = typeof signal.plan.targets[0] === "number" && (signal.direction === "short"
      ? executableLow(candle, "buy") <= signal.plan.targets[0]
      : executableHigh(candle, "sell") >= signal.plan.targets[0]);

    if (stopHit) {
      const reason = stoppedReason(signal, maxFavorableR);
      return {
        status: "stopped",
        rMultiple: -1,
        maxFavorableR,
        maxAdverseR,
        candlesHeld: index + 1,
        outcomeReason: reason,
        tags,
        note: "Entry sonrası stop görüldü."
      };
    }
    if (tp2Hit) {
      return {
        status: "tp2",
        rMultiple: targetR(signal, 1),
        maxFavorableR,
        maxAdverseR,
        candlesHeld: index + 1,
        outcomeReason: "clean-model",
        tags,
        note: "Entry sonrası TP2 görüldü."
      };
    }
    if (tp1Hit) {
      return {
        status: "tp1",
        rMultiple: targetR(signal, 0),
        maxFavorableR,
        maxAdverseR,
        candlesHeld: index + 1,
        outcomeReason: "clean-model",
        tags,
        note: "Entry sonrası TP1 görüldü."
      };
    }
  }

  return {
    status: "open",
    rMultiple: Math.max(-1, Math.min(maxFavorableR, 0.5)),
    maxFavorableR,
    maxAdverseR,
    candlesHeld: afterEntry.length,
    outcomeReason: "expired",
    tags,
    note: `Süre doldu; max ${maxFavorableR.toFixed(2)}R, adverse ${maxAdverseR.toFixed(2)}R.`
  };
}

function bestSymbol(trades: RuntimeReplayTrade[]): string {
  const bySymbol = symbolSummaries(trades);
  return [...bySymbol].sort((a, b) => b.totalR - a.totalR)[0]?.symbol ?? "";
}

function symbolSummaries(trades: RuntimeReplayTrade[]) {
  const symbols = Array.from(new Set(trades.map((trade) => trade.symbol))).sort();
  return symbols.map((symbol) => {
    const symbolTrades = trades.filter((trade) => trade.symbol === symbol);
    const triggered = symbolTrades.filter((trade) => trade.status !== "not-triggered");
    const wins = triggered.filter((trade) => trade.rMultiple > 0).length;
    return {
      symbol,
      readyAlerts: symbolTrades.length,
      triggeredTrades: triggered.length,
      totalR: Number(symbolTrades.reduce((sum, trade) => sum + trade.rMultiple, 0).toFixed(2)),
      winRate: triggered.length ? (wins / triggered.length) * 100 : 0
    };
  });
}

function failureReasonSummary(trades: RuntimeReplayTrade[]) {
  const reasons = new Map<RuntimeReplayOutcomeReason, { count: number; totalR: number }>();
  for (const trade of trades) {
    if (trade.rMultiple > 0 && trade.outcomeReason === "clean-model") continue;
    const current = reasons.get(trade.outcomeReason) ?? { count: 0, totalR: 0 };
    current.count += 1;
    current.totalR = Number((current.totalR + trade.rMultiple).toFixed(2));
    reasons.set(trade.outcomeReason, current);
  }
  return [...reasons.entries()]
    .map(([reason, value]) => ({ reason, ...value }))
    .sort((a, b) => b.count - a.count || a.totalR - b.totalR);
}

function tagLabel(tag: string): string {
  const [group, value] = tag.split(":");
  if (group === "reason") {
    if (value === "clean-model") return "Temiz model";
    if (value === "stop-too-tight") return "Stop dar";
    if (value === "event-risk") return "Event riski";
    if (value === "range-chop") return "Range/chop";
    if (value === "htf-conflict") return "HTF conflict";
    if (value === "entry-not-filled") return "Entry dolmadı";
    if (value === "expired") return "Süre doldu";
    return "Bilinmeyen neden";
  }
  if (group === "pd") return value === "mismatch" ? "PD mismatch" : value === "aligned" ? "PD aligned" : `PD ${value}`;
  if (group === "htf") return value === "conflict" ? "HTF conflict" : "HTF aligned";
  if (group === "smt") return value === "none" ? "SMT yok" : "SMT aligned";
  if (group === "rr") return value === "2plus" ? "RR 2+" : value === "ok" ? "RR uygun" : "RR düşük";
  if (group === "entry-status") return `Entry ${value}`;
  return `${group} ${value}`;
}

function calibrationFromTrades(trades: RuntimeReplayTrade[], watchAlerts: number): RuntimeReplayCalibration[] {
  const insights: RuntimeReplayCalibration[] = [];
  if (!trades.length) {
    insights.push({
      label: "READY üretimi",
      value: "0",
      detail: watchAlerts > 0
        ? `${watchAlerts} WATCH var ama READY yok. Entry/MSS/FVG şartları fazla sıkı veya son 1 ay model gelmemiş.`
        : "Son pencerede model setup üretmedi; veri ve market koşulu bekleniyor.",
      verdict: "investigate"
    });
    return insights;
  }

  const tagStats = new Map<string, { count: number; totalR: number; wins: number }>();
  for (const trade of trades) {
    for (const tag of trade.tags) {
      const current = tagStats.get(tag) ?? { count: 0, totalR: 0, wins: 0 };
      current.count += 1;
      current.totalR += trade.rMultiple;
      if (trade.rMultiple > 0) current.wins += 1;
      tagStats.set(tag, current);
    }
  }

  for (const [tag, stat] of [...tagStats.entries()].filter(([, stat]) => stat.count >= 2)) {
    const avgR = stat.totalR / stat.count;
    if (avgR <= -0.35) {
      insights.push({
        label: tagLabel(tag),
        value: `${avgR.toFixed(2)}R`,
        detail: `${stat.count} örnekte negatif. Bu koşul READY'i WATCH'a düşürmek için aday.`,
        verdict: "tighten"
      });
    } else if (avgR >= 0.45) {
      insights.push({
        label: tagLabel(tag),
        value: `${avgR.toFixed(2)}R`,
        detail: `${stat.count} örnekte pozitif. Bu filtre korunmalı, hatta skor ağırlığı artırılabilir.`,
        verdict: "keep"
      });
    }
  }

  const reasons = failureReasonSummary(trades);
  const topReason = reasons[0];
  if (topReason) {
    insights.push({
      label: `Ana kayıp nedeni: ${tagLabel(`reason:${topReason.reason}`)}`,
      value: `${topReason.count}`,
      detail: `${topReason.totalR.toFixed(2)}R toplam etki. Stop/event/rejim filtrelerini buna göre sıkılaştır.`,
      verdict: "investigate"
    });
  }

  return insights
    .sort((a, b) => {
      const priority = { tighten: 0, investigate: 1, keep: 2, relax: 3 } as const;
      return priority[a.verdict] - priority[b.verdict];
    })
    .slice(0, 8);
}

function streak(returns: number[], winning: boolean): number {
  let best = 0;
  let current = 0;
  for (const value of returns) {
    const match = winning ? value > 0 : value < 0;
    current = match ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}

export function runMonthlyRuntimeReplay({
  markets,
  strategy,
  settings,
  windowDays = DEFAULT_WINDOW_DAYS,
  maxHoldCandles = DEFAULT_MAX_HOLD_CANDLES,
  scanEveryCandles = DEFAULT_SCAN_EVERY_CANDLES
}: RuntimeReplayInput): BacktestResult {
  const endedAt = latestReplayTime(markets);
  const earliest = earliestReplayTime(markets);
  const startedAt = Math.max(earliest, endedAt - windowDays * DAY_MS);
  const dataAvailableDays = endedAt > earliest ? (endedAt - earliest) / DAY_MS : 0;
  const replayedDays = endedAt > startedAt ? (endedAt - startedAt) / DAY_MS : 0;
  const setupStates = new Map<string, SetupState>();
  const marketBySymbol = new Map(markets.map((market) => [market.symbol, market]));
  const trades: RuntimeReplayTrade[] = [];
  let scannedWindows = 0;
  let watchAlerts = 0;
  let readyAlerts = 0;

  for (const time of replayTimes(markets, startedAt, endedAt, scanEveryCandles)) {
    const contexts = attachSmtDivergences(
      markets
        .map((market) => ({ market, timeframes: timeframesAt(market, time) }))
        .filter(({ timeframes }) => enoughWarmupTimeframes(timeframes))
        .map(({ market, timeframes }) => buildMarketContext(market.symbol, timeframes))
        .filter(enoughWarmup)
    );
    scannedWindows += contexts.length;

    for (const context of contexts) {
      const signal = strategy.scan({ context, settings }).signals[0];
      if (!signal || signal.stage === "invalidated" || signal.stage === "missed") continue;

      const key = setupKey(signal);
      const previous = setupStates.get(key);
      const state = previous && time - previous.lastSeen <= SETUP_COOLDOWN_MS
        ? previous
        : { lastSeen: time, countedWatch: false, countedReady: false };
      state.lastSeen = time;

      if (signal.stage === "watch" && !state.countedWatch) {
        watchAlerts += 1;
        state.countedWatch = true;
      }

      if (signal.stage === "ready" && !state.countedReady) {
        const market = marketBySymbol.get(signal.symbol);
        const outcome = evaluateForwardOutcome(signal, market ? futureCandlesForSignal(market, time, maxHoldCandles) : []);
        trades.push({
          id: `${signal.id}-replay`,
          symbol: signal.symbol,
          direction: signal.direction,
          signalTime: time,
          grade: signal.grade,
          score: signal.score,
          entry: signal.plan.entry,
          stopLoss: signal.plan.stopLoss,
          target: signal.plan.targets[0] ?? signal.plan.entry,
          ...outcome
        });
        readyAlerts += 1;
        state.countedReady = true;
      }

      setupStates.set(key, state);
    }
  }

  const returns = trades.map((trade) => trade.rMultiple);
  const triggered = trades.filter((trade) => trade.status !== "not-triggered");
  const wins = triggered.filter((trade) => trade.rMultiple > 0);
  const losses = triggered.filter((trade) => trade.rMultiple < 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.rMultiple, 0));
  const equityCurve = equityCurveFromReturns(returns);
  const totalR = Number(returns.reduce((sum, value) => sum + value, 0).toFixed(2));
  const bySymbol = symbolSummaries(trades);
  const tp1Trades = trades.filter((trade) => trade.status === "tp1").length;
  const tp2Trades = trades.filter((trade) => trade.status === "tp2").length;
  const stoppedTrades = trades.filter((trade) => trade.status === "stopped").length;
  const notTriggered = trades.filter((trade) => trade.status === "not-triggered").length;
  const openTrades = trades.filter((trade) => trade.status === "open").length;
  const sampleWarning = dataAvailableDays + 0.5 < windowDays
    ? `Mevcut data ${dataAvailableDays.toFixed(1)} gün; tam ${windowDays} gün için provider 15m geçmişi gerekir.`
    : undefined;

  return {
    totalTrades: triggered.length,
    winRate: triggered.length ? (wins.length / triggered.length) * 100 : 0,
    lossRate: triggered.length ? (losses.length / triggered.length) * 100 : 0,
    averageRR: trades.length ? trades.reduce((sum, trade) => sum + Math.max(0, trade.maxFavorableR), 0) / trades.length : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin,
    maxDrawdown: maxDrawdown(equityCurve),
    maxWinStreak: streak(returns, true),
    maxLossStreak: streak(returns, false),
    bestKillzone: "Runtime replay",
    bestSymbol: bestSymbol(trades),
    bestSetupGrade: [...trades].sort((a, b) => b.rMultiple - a.rMultiple)[0]?.grade ?? "",
    bestPremiumDiscountLocation: "Measured from closed-candle replay",
    worstCondition: stoppedTrades > wins.length ? "Stops dominate TP hits" : "Sample still building",
    equityCurve,
    replay: {
      mode: "runtime-replay",
      strategyId: strategy.id,
      windowDays,
      scanEveryCandles,
      availableDays: replayedDays,
      startedAt,
      endedAt,
      scannedWindows,
      readyAlerts,
      watchAlerts,
      triggeredTrades: triggered.length,
      notTriggered,
      openTrades,
      stoppedTrades,
      tp1Trades,
      tp2Trades,
      totalR,
      expectancyR: triggered.length ? totalR / triggered.length : 0,
      bySymbol,
      calibration: calibrationFromTrades(trades, watchAlerts),
      failureReasons: failureReasonSummary(trades),
      trades: trades.slice(-80).reverse(),
      sampleWarning
    }
  };
}
