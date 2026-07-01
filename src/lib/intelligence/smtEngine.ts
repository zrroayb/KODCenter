import type { Candle, MarketContext, MarketSymbol, SmtDivergence, TradeDirection } from "../ict/types";

const SMT_PARTNERS: Partial<Record<MarketSymbol, MarketSymbol[]>> = {
  EURUSD: ["GBPUSD"],
  GBPUSD: ["EURUSD"],
  NAS100: ["BTCUSD"],
  BTCUSD: ["NAS100"]
};

function executionCandles(context: MarketContext): Candle[] {
  return context.timeframes.m15.length ? context.timeframes.m15 : context.timeframes.m5;
}

function priorHigh(candles: Candle[], endIndex: number, lookback: number): number {
  const start = Math.max(0, endIndex - lookback);
  const sample = candles.slice(start, endIndex);
  return sample.length ? Math.max(...sample.map((candle) => candle.high)) : candles[endIndex]?.high ?? 0;
}

function priorLow(candles: Candle[], endIndex: number, lookback: number): number {
  const start = Math.max(0, endIndex - lookback);
  const sample = candles.slice(start, endIndex);
  return sample.length ? Math.min(...sample.map((candle) => candle.low)) : candles[endIndex]?.low ?? 0;
}

function toleranceFor(level: number): number {
  return Math.max(Math.abs(level) * 0.00002, 0.000001);
}

function latestAlignedIndex(primary: Candle[], partner: Candle[]): number {
  const latestTime = primary[primary.length - 1]?.time;
  if (typeof latestTime !== "number") return Math.min(primary.length, partner.length) - 1;
  const exact = partner.findIndex((candle) => candle.time === latestTime);
  return exact >= 0 ? exact : Math.min(primary.length, partner.length) - 1;
}

function divergenceForSide(input: {
  context: MarketContext;
  partner: MarketContext;
  primaryCandles: Candle[];
  partnerCandles: Candle[];
  primaryIndex: number;
  partnerIndex: number;
  side: "buy-side" | "sell-side";
  lookback: number;
}): SmtDivergence | undefined {
  const primary = input.primaryCandles[input.primaryIndex];
  const partner = input.partnerCandles[input.partnerIndex];
  if (!primary || !partner) return undefined;

  if (input.side === "buy-side") {
    const localLevel = priorHigh(input.primaryCandles, input.primaryIndex, input.lookback);
    const partnerLevel = priorHigh(input.partnerCandles, input.partnerIndex, input.lookback);
    const primaryBreaks = primary.high > localLevel + toleranceFor(localLevel);
    const partnerConfirms = partner.high > partnerLevel + toleranceFor(partnerLevel);
    if (!primaryBreaks || partnerConfirms) return undefined;
    return {
      partner: input.partner.symbol,
      direction: "short",
      side: "buy-side",
      candleIndex: input.primaryIndex,
      time: primary.time,
      localLevel,
      partnerLevel,
      localExtreme: primary.high,
      partnerExtreme: partner.high,
      note: `${input.context.symbol} buy-side high aldı, ${input.partner.symbol} high teyit etmedi. Bearish SMT.`
    };
  }

  const localLevel = priorLow(input.primaryCandles, input.primaryIndex, input.lookback);
  const partnerLevel = priorLow(input.partnerCandles, input.partnerIndex, input.lookback);
  const primaryBreaks = primary.low < localLevel - toleranceFor(localLevel);
  const partnerConfirms = partner.low < partnerLevel - toleranceFor(partnerLevel);
  if (!primaryBreaks || partnerConfirms) return undefined;
  return {
    partner: input.partner.symbol,
    direction: "long",
    side: "sell-side",
    candleIndex: input.primaryIndex,
    time: primary.time,
    localLevel,
    partnerLevel,
    localExtreme: primary.low,
    partnerExtreme: partner.low,
    note: `${input.context.symbol} sell-side low aldı, ${input.partner.symbol} low teyit etmedi. Bullish SMT.`
  };
}

export function detectSmtDivergences(context: MarketContext, allContexts: MarketContext[], lookback = 20): SmtDivergence[] {
  const partners = SMT_PARTNERS[context.symbol] ?? [];
  const primaryCandles = executionCandles(context);
  if (primaryCandles.length < lookback + 2) return [];

  const divergences: SmtDivergence[] = [];
  for (const partnerSymbol of partners) {
    const partner = allContexts.find((item) => item.symbol === partnerSymbol);
    if (!partner) continue;
    const partnerCandles = executionCandles(partner);
    if (partnerCandles.length < lookback + 2) continue;
    const primaryIndex = primaryCandles.length - 1;
    const partnerIndex = latestAlignedIndex(primaryCandles, partnerCandles);
    for (const side of ["buy-side", "sell-side"] as const) {
      const divergence = divergenceForSide({
        context,
        partner,
        primaryCandles,
        partnerCandles,
        primaryIndex,
        partnerIndex,
        side,
        lookback
      });
      if (divergence) divergences.push(divergence);
    }
  }
  return divergences;
}

export function attachSmtDivergences(contexts: MarketContext[]): MarketContext[] {
  return contexts.map((context) => ({
    ...context,
    smtDivergences: detectSmtDivergences(context, contexts)
  }));
}
