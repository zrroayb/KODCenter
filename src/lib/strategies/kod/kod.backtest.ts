import type { BacktestInput } from "../types";
import { kodStrategy } from "./kod.strategy";

export function backtestKod(input: BacktestInput) {
  return kodStrategy.backtest(input);
}
