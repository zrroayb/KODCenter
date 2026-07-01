import type { Candle, MarketSymbol, Timeframe } from "../ict/types";

export type CandleRequest = {
  symbol: MarketSymbol;
  timeframe: Timeframe;
  limit: number;
};

export type MarketDataProvider = {
  id: string;
  name: string;
  getCandles(request: CandleRequest): Promise<Candle[]>;
};
