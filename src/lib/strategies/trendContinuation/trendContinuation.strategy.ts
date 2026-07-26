import { performanceFromSignals } from "../../analytics/performance";
import { averageTrueRange } from "../../ict/candles";
import { formatPrice, formatR } from "../../ict/format";
import type {
  Candle, DecisionChecklistItem, FairValueGap, MarketContext, OrderBlock,
  SignalEvidenceItem, TradeDirection, TradePlan, TradingSignal
} from "../../ict/types";
import { detectFairValueGaps, detectOrderBlocks, detectSwingPoints } from "../../intelligence/structureEngine";
import { detectStructuralBias } from "../../intelligence/structuralBias";
import { estimateExecutionCosts } from "../../risk/executionCosts";
import type { BacktestInput, StrategyInput, StrategyModule, StrategyResult } from "../types";

export const TREND_CONTINUATION_STRATEGY_ID = "trend-continuation";
const DEFAULT_MINIMUM_RR = 1.5;
// Taze BOS yoksa pullback POI'yi son bu kadar exec mumunda ararız (mature trendde kırılım geçmişte
// kalmış olabilir; çok eski POI'yi almamak için pencere).
const CONTINUATION_POI_LOOKBACK = 120;

// İKİNCİ PLAYBOOK — Trend Continuation (CRT Reversal'ın tersi mantık).
//   HTF trend → trend yönünde kabullü breakout (BOS, CHoCH DEĞİL) → pullback/FVG-OB retest →
//   trend yönünde likidite hedefi.
// Owner kuralı: "sweep gördük diye otomatik ters işlem YOK." Bu modül yalnızca trend güçlü VE
// fiyat kırılım yönünde kabul görüyorken (same-direction BOS) devreye girer; reclaim + karşı yapı
// dönüşü reversal'a aittir. İki playbook yapısal olarak birbirini dışlar (BOS vs CHoCH+reclaim),
// böylece aynı setup iki isimle görünmez.

type ContinuationSettings = { minimumRR: number; stress: "off" | "normal" | "high" };

function readSettings(input: StrategyInput): ContinuationSettings {
  const minimumRR = typeof input.settings.minimumRR === "number" ? input.settings.minimumRR : DEFAULT_MINIMUM_RR;
  const useCosts = input.settings.useExecutionCosts !== false;
  const stress = !useCosts ? "off" : input.settings.slippageStress === "high" ? "high" : "normal";
  return { minimumRR, stress };
}

// HTF trend: daily yapısal yön, h4 teyidi. Owner kuralı — trend yoksa continuation da yok.
function trendDirection(context: MarketContext): { direction: TradeDirection | "none"; confidence: "strong" | "moderate" | "weak"; reason: string } {
  const daily = detectStructuralBias(context.timeframes.daily);
  const h4 = detectStructuralBias(context.timeframes.h4);
  const trending = daily.pattern === "uptrend" || daily.pattern === "downtrend";
  if (!trending || daily.bias === "neutral") {
    return { direction: "none", confidence: "weak", reason: `1D trend yok (${daily.pattern}); continuation aranmaz.` };
  }
  const dir: TradeDirection = daily.bias === "bullish" ? "long" : "short";
  const h4Opposes = h4.bias !== "neutral" && (h4.bias === "bullish" ? "long" : "short") !== dir;
  if (h4Opposes) {
    return { direction: "none", confidence: "weak", reason: `1D ${dir} ama 4H ters (${h4.bias}); trend teyidi yok.` };
  }
  const confidence = daily.confidence === "strong" && h4.bias !== "neutral" ? "strong" : daily.confidence;
  return { direction: dir, confidence, reason: `1D ${daily.pattern} + 4H ${h4.bias === "neutral" ? "nötr" : "uyumlu"}.` };
}

function poiNearEdge(poi: FairValueGap | OrderBlock, direction: TradeDirection): number {
  return direction === "long" ? poi.high : poi.low;
}
function poiFarEdge(poi: FairValueGap | OrderBlock, direction: TradeDirection): number {
  return direction === "long" ? poi.low : poi.high;
}

// Trend yönünde, breakout bacağının bıraktığı en güncel POI (FVG önce, OB sonra).
// `mitigated` = fiyat POI'ye geri dönüp temas etti = retest (bullish FVG through-close olursa
// dedektör yönü "short"a çevirir, o yüzden yön filtresi ihlal olmuş gap'i zaten eler). Yani
// mitigated bayrağı burada "retest oldu" anlamına gelir; ayrı manuel retest taramasına gerek yok.
function pullbackPoi(
  candles: Candle[], direction: TradeDirection, breakoutIndex: number
): { poi: FairValueGap | OrderBlock; kind: "FVG" | "OB"; retested: boolean } | undefined {
  const fvgs = detectFairValueGaps(candles)
    .filter((gap) => gap.direction === direction && gap.candleIndex >= breakoutIndex)
    .sort((a, b) => b.candleIndex - a.candleIndex);
  if (fvgs[0]) return { poi: fvgs[0], kind: "FVG", retested: fvgs[0].mitigated };
  const swings = detectSwingPoints(candles, 3);
  const obs = detectOrderBlocks(candles, swings)
    .filter((block) => block.direction === direction && block.candleIndex >= breakoutIndex)
    .sort((a, b) => b.candleIndex - a.candleIndex);
  if (obs[0]) return { poi: obs[0], kind: "OB", retested: obs[0].mitigated };
  return undefined;
}

// Trend yönünde bir sonraki dış likidite = hedef (long için üstte buy-side, short için altta sell-side).
function continuationTarget(context: MarketContext, direction: TradeDirection, entry: number): { level: number; label: string } | undefined {
  const draws = context.liquidityObjectives.filter((objective) =>
    direction === "long" ? objective.side === "buy-side" && objective.level > entry : objective.side === "sell-side" && objective.level < entry
  );
  if (!draws.length) return undefined;
  const best = draws.sort((a, b) => direction === "long" ? a.level - b.level : b.level - a.level)[0];
  return { level: best.level, label: best.label };
}

function checklistItem(label: string, status: DecisionChecklistItem["status"], explanation: string): DecisionChecklistItem {
  return { label, status, explanation };
}

function continuationSignal(context: MarketContext, settings: ContinuationSettings): TradingSignal | undefined {
  const exec = context.timeframes.h1;
  if (exec.length < 15 || context.timeframes.daily.length < 10) return undefined;

  const trend = trendDirection(context);
  if (trend.direction === "none") return undefined;
  const direction = trend.direction;

  // Kabullü breakout. Owner modeli: "HTF trend → breakout kabulü → pullback". Kabul iki yoldan
  // gelir: (a) execution TF'de trend YÖNÜNDE taze BOS, VEYA (b) kurulu exec trendi (HH+HL / LH+LL).
  // Her taramada taze h1 BOS ŞART DEĞİL — mature trendde fiyat tepede/dipte pullback'te olabilir ve
  // o an taze kırılım olmaz; yine de trend kabul edilmiştir (bkz. USDCHF: daily strong uptrend ama
  // h1'de o an lastEvent yok). Ayrım kuralı: ters yönde CHoCH varsa (reclaim/yapı dönüşü) bu
  // continuation DEĞİL, reversal'a aittir → kabul geçersiz.
  const execBias = detectStructuralBias(exec);
  const event = execBias.lastEvent;
  const lastClose = exec[exec.length - 1].close;
  const opposingChoch = Boolean(event && event.kind === "choch" && event.direction !== direction);
  const freshBos = Boolean(event && event.kind === "bos" && event.direction === direction);
  const structureTrending = execBias.pattern === (direction === "long" ? "uptrend" : "downtrend");
  const accepted = !opposingChoch && (freshBos || structureTrending);

  const buffer = averageTrueRange(exec, 14) * 0.25;
  // Pullback POI: taze BOS varsa kırılım bacağından, yoksa son POI_LOOKBACK mumluk pencereden
  // trend yönünde retest edilmiş (mitigated) FVG/OB.
  const poiFloor = freshBos && event ? event.candleIndex : Math.max(0, exec.length - CONTINUATION_POI_LOOKBACK);
  const poiHit = accepted ? pullbackPoi(exec, direction, poiFloor) : undefined;

  // Plan geometrisi
  const entry = poiHit ? poiNearEdge(poiHit.poi, direction) : lastClose;
  const protectedLevel = direction === "long" ? execBias.protectedLow : execBias.protectedHigh;
  const stopBase = poiHit ? poiFarEdge(poiHit.poi, direction) : protectedLevel ?? entry;
  const stopLoss = direction === "long" ? Math.min(stopBase, protectedLevel ?? stopBase) - buffer : Math.max(stopBase, protectedLevel ?? stopBase) + buffer;
  const target = continuationTarget(context, direction, entry);
  const stopValid = direction === "long" ? stopLoss < entry : stopLoss > entry;
  const targetValid = Boolean(target) && (direction === "long" ? target!.level > entry : target!.level < entry);
  const tp = target?.level ?? entry;
  const costs = estimateExecutionCosts({ symbol: context.symbol, entry, stopLoss, target: tp, stress: settings.stress });
  const riskDistance = Math.max(Math.abs(entry - stopLoss), 1e-9);

  // Retest zorunlu (owner kuralı ile tutarlı): POI mitigate olduysa (fiyat geri dönüp temas etti)
  // confirmed; henüz temas yoksa pending. Through-close olan gap yön filtresinde zaten elenir.
  const retested = poiHit?.retested ?? false;
  const entryStatus: TradePlan["entryStatus"] = poiHit ? (retested ? "confirmed" : "pending") : "fallback";

  const blockers = [
    opposingChoch ? "Ters yönde CHoCH var; bu continuation değil, reversal bölgesi." : undefined,
    !poiHit ? "Pullback FVG/OB yok; trend yönünde geri çekilme bölgesi bekleniyor." : undefined,
    !stopValid ? "Stop girişin yanlış tarafında; plan geometrisi bozuk." : undefined,
    !targetValid ? "Trend yönünde ulaşılabilir likidite hedefi yok." : undefined,
    costs.netRR < settings.minimumRR ? `RR ${costs.netRR.toFixed(2)} < minimum ${settings.minimumRR}.` : undefined,
    context.dataConfidence.score < 35 ? context.dataConfidence.summary : undefined
  ].filter((item): item is string => Boolean(item));

  // Trend kabulü yoksa continuation da yok — boş/karşı-trend radar kaydı üretme.
  if (!accepted) return undefined;

  const readyEligible = blockers.length === 0 && entryStatus === "confirmed";
  const stage: TradingSignal["stage"] = readyEligible ? "ready" : "watch";

  const score = Math.max(0, Math.min(100,
    20
    + (accepted ? 25 : 0)
    + (freshBos ? 10 : 0)
    + (poiHit ? 15 : 0)
    + (retested ? 10 : 0)
    + (targetValid && costs.netRR >= settings.minimumRR ? 10 : Math.round(Math.max(0, costs.netRR) * 3))
    + (trend.confidence === "strong" ? 5 : trend.confidence === "moderate" ? 3 : 0)
  ));
  const grade = score >= 90 ? "A+" : score >= 80 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";

  const plan: TradePlan = {
    entry,
    entrySource: poiHit ? "poi-retest" : "fallback-close",
    entryStatus,
    entryModel: {
      source: poiHit ? "poi-retest" : "fallback-close",
      status: entryStatus,
      level: entry,
      retested,
      cisdConfirmed: accepted,
      fairValueGap: poiHit?.kind === "FVG" ? (poiHit.poi as FairValueGap) : undefined,
      warnings: entryStatus === "confirmed" ? [] : [`${poiHit ? poiHit.kind + " retest" : "pullback"} bekleniyor; kabullü breakout kapanışı kovalanmaz.`]
    },
    stopLoss,
    targets: [tp],
    invalidation: stopLoss,
    rr: costs.netRR,
    grossRR: costs.grossRR,
    riskDistance,
    stopSource: poiHit ? "fvg" : "swing",
    stopBuffer: buffer,
    targetSource: "liquidity",
    executionCosts: costs,
    planWarnings: [
      `Trend continuation: ${trend.reason}`,
      poiHit ? `Pullback ${poiHit.kind} ${formatPrice(poiHit.poi.low)}-${formatPrice(poiHit.poi.high)}; retest girişi.` : "Pullback POI bekleniyor.",
      target ? `Hedef trend yönünde likidite: ${target.label} ${formatPrice(tp)}.` : "Hedef likidite yok."
    ]
  };

  const evidence: SignalEvidenceItem[] = [
    { id: "tc-htf-trend", label: "HTF Trend", status: "pass", detail: trend.reason, timeframe: "1d" },
    { id: "tc-breakout", label: "Kabullü Breakout (BOS)", status: accepted ? "pass" : "fail", detail: opposingChoch ? "Ters CHoCH: kabul yok, reversal bölgesi." : freshBos && event ? `${direction === "long" ? "Yukarı" : "Aşağı"} BOS ${formatPrice(event.level)}; kabul geçerli.` : accepted ? `Kurulu ${direction === "long" ? "uptrend" : "downtrend"} yapısı; fiyat kırılım yönünde kabul görüyor.` : "Kabul yok.", timeframe: "1h", price: freshBos ? event?.level : undefined },
    { id: "tc-pullback", label: "Pullback POI", status: poiHit ? "pass" : "fail", detail: poiHit ? `${poiHit.kind} ${formatPrice(poiHit.poi.low)}-${formatPrice(poiHit.poi.high)}` : "Trend yönünde FVG/OB yok.", timeframe: "1h", price: poiHit ? entry : undefined },
    { id: "tc-entry", label: "Retest Girişi", status: entryStatus === "confirmed" ? "pass" : "neutral", detail: entryStatus === "confirmed" ? `Retest oldu; giriş ${formatPrice(entry)}.` : `Giriş ${formatPrice(entry)} retest teması bekleniyor.`, timeframe: "1h", price: entry },
    { id: "tc-target", label: "Trend Likidite Hedefi", status: targetValid ? "pass" : "fail", detail: target ? `${target.label} ${formatPrice(tp)}; RR ${formatR(costs.netRR)}.` : "Hedef yok.", price: targetValid ? tp : undefined }
  ];

  const checklist = evidence.map((item) => checklistItem(item.label, item.status === "pass" ? "pass" : item.status === "fail" ? "fail" : "neutral", item.detail));
  const summary = stage === "ready"
    ? `${context.symbol} ${direction === "long" ? "LONG" : "SHORT"} trend devamı: pullback retest hazır, hedef ${formatPrice(tp)}.`
    : blockers[0] ?? "Trend devamı gelişiyor; retest bekleniyor.";

  return {
    id: `${context.symbol}-${direction}-${exec.at(-1)?.time ?? Date.now()}-trend-continuation`,
    strategyId: TREND_CONTINUATION_STRATEGY_ID,
    symbol: context.symbol,
    direction,
    stage,
    grade,
    score,
    createdAt: Date.now(),
    timeframe: "1h",
    plan,
    context,
    decisionSummary: {
      shortSummary: summary,
      fullReasoning: [`${context.symbol} Trend Continuation (${direction.toUpperCase()}).`, ...plan.planWarnings].join(" "),
      checklist,
      warnings: blockers,
      invalidation: [`${formatPrice(stopLoss)} altına/üstüne kabul continuation'ı bozar.`],
      confidence: Math.min(100, score)
    },
    evidence,
    riskWarnings: blockers,
    outcome: {
      status: "not-triggered", entryTouched: retested, maxFavorableR: 0, maxAdverseR: 0, candlesTracked: 0,
      summary: stage === "ready" ? "Trend continuation READY." : "Trend continuation gelişiyor."
    },
    governance: {
      status: blockers.length ? "block" : stage === "ready" ? "allow" : "caution",
      scoreImpact: 0,
      blockers,
      warnings: [],
      checklist,
      summary: blockers[0] ?? summary
    },
    actionWindow: {
      status: stage === "ready" ? "valid" : "waiting",
      candlesRemaining: 0,
      summary: stage === "ready" ? "Retest girişi aktif." : "Pullback retest bekleniyor."
    }
  };
}

export const trendContinuationStrategy: StrategyModule = {
  id: TREND_CONTINUATION_STRATEGY_ID,
  name: "Trend Continuation",
  description: "HTF trend → kabullü breakout (BOS) → pullback FVG/OB retest → trend yönünde likidite hedefi. Reversal değil.",
  requiredTimeframes: ["1d", "4h", "1h", "15m"],
  defaultSettings: {
    minimumRR: DEFAULT_MINIMUM_RR,
    useExecutionCosts: true,
    slippageStress: "normal"
  },
  scan(input: StrategyInput): StrategyResult {
    const signal = continuationSignal(input.context, readSettings(input));
    return {
      signals: signal ? [signal] : [],
      rejectedSetups: signal && signal.stage !== "ready"
        ? [{ symbol: input.context.symbol, strategyId: TREND_CONTINUATION_STRATEGY_ID, reason: signal.governance.blockers[0] ?? "Trend devamı bekleniyor.", score: signal.score }]
        : []
    };
  },
  backtest(input: BacktestInput) {
    return performanceFromSignals(
      input.contexts
        .map((context) => continuationSignal(context, readSettings({ context, settings: input.settings })))
        .filter((signal): signal is TradingSignal => Boolean(signal))
    );
  }
};
