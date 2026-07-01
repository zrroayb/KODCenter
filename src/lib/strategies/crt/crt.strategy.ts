import type { StrategyModule } from "../types";
import { emptyBacktestResult } from "../placeholderStrategy";

export const crtStrategy: StrategyModule = {
  id: "crt",
  name: "CRT Setups",
  description: "Placeholder for future Candle Range Theory modules.",
  requiredTimeframes: ["1d", "4h", "1h", "15m"],
  defaultSettings: {},
  scan: () => ({ signals: [], rejectedSetups: [] }),
  backtest: emptyBacktestResult
};
