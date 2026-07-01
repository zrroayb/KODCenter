import type { ICTBias, LiquidityPool, MarketSymbol, TradingSignal } from "../ict/types";
import type { RejectedSetup } from "../strategies/types";
import type { ScanHistory } from "./scanHistory";

export type RuntimeMarketMemory = {
  activeSymbol: MarketSymbol;
  lastScanTime: number;
  latestBias: ICTBias;
  previousBias?: ICTBias;
  recentSignals: TradingSignal[];
  rejectedSetups: RejectedSetup[];
  liquidityMap: LiquidityPool[];
  scanHistory: ScanHistory;
};
