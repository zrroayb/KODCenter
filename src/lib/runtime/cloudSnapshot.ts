import type { DemoMarket } from "../../data/demoData";
import type { MarketSymbol, TradingSignal } from "../ict/types";
import type { ScanRuntimeResult } from "./scanRuntime";

export type CompactSignal = Omit<TradingSignal, "context"> & {
  context: {
    symbol: MarketSymbol;
    bias: TradingSignal["context"]["bias"];
    premiumDiscount: TradingSignal["context"]["premiumDiscount"];
    dataFeed: TradingSignal["context"]["dataFeed"];
    dataConfidence: TradingSignal["context"]["dataConfidence"];
    regime: TradingSignal["context"]["regime"];
  };
};

export type SymbolScanSnapshot = {
  signals: CompactSignal[];
  hiddenSignals: CompactSignal[];
  inactiveSignals: CompactSignal[];
  rejected: ScanRuntimeResult["rejected"];
};

export function compactSignal(signal: TradingSignal): CompactSignal {
  const { context, ...rest } = signal;
  return {
    ...rest,
    context: {
      symbol: context.symbol,
      bias: context.bias,
      premiumDiscount: context.premiumDiscount,
      dataFeed: context.dataFeed,
      dataConfidence: context.dataConfidence,
      regime: context.regime
    }
  };
}

export function leanMarketForStorage(market: DemoMarket): DemoMarket {
  const leanCandles = (candles: DemoMarket["timeframes"]["m15"]) => candles.map((candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    closed: candle.closed
  }));

  return {
    symbol: market.symbol,
    name: market.name,
    timeframes: {
      monthly: leanCandles(market.timeframes.monthly),
      weekly: leanCandles(market.timeframes.weekly),
      daily: leanCandles(market.timeframes.daily),
      h4: leanCandles(market.timeframes.h4),
      h1: leanCandles(market.timeframes.h1),
      m15: leanCandles(market.timeframes.m15),
      m5: leanCandles(market.timeframes.m5)
    }
  };
}

export function scanSnapshotForSymbol(
  symbol: MarketSymbol,
  result: ScanRuntimeResult
): SymbolScanSnapshot {
  return {
    signals: result.signals.filter((signal) => signal.symbol === symbol).map(compactSignal),
    hiddenSignals: result.hiddenSignals.filter((signal) => signal.symbol === symbol).map(compactSignal),
    inactiveSignals: result.inactiveSignals.filter((signal) => signal.symbol === symbol).map(compactSignal),
    rejected: result.rejected.filter((setup) => setup.symbol === symbol)
  };
}
