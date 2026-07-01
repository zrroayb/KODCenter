import { emptyBacktestResult } from "../placeholderStrategy";
import type { StrategyModule } from "../types";

export const orderBlockStrategy: StrategyModule = {
  id: "order-block",
  name: "Order Blocks",
  description: "Placeholder for order block, breaker block, and mitigation block strategy modules.",
  requiredTimeframes: ["1d", "4h", "1h", "15m"],
  defaultSettings: {},
  scan: () => ({ signals: [], rejectedSetups: [] }),
  backtest: emptyBacktestResult
};
