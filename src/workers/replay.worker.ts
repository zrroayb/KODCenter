/// <reference lib="webworker" />

import { runMonthlyRuntimeReplay } from "../lib/backtest/runtimeReplay";
import { getStrategy } from "../lib/strategies/registry";
import type { DemoMarket } from "../data/demoData";
import type { StrategySettings } from "../lib/strategies/types";

type ReplayRequest = {
  markets: DemoMarket[];
  settings: StrategySettings;
  // Hangi playbook ölçülüyor: "crt" (reversal) veya "trend-continuation". Boşsa CRT.
  strategyId?: string;
};

self.onmessage = (event: MessageEvent<ReplayRequest>) => {
  try {
    const strategy = getStrategy(event.data.strategyId ?? "crt");
    const result = runMonthlyRuntimeReplay({
      markets: event.data.markets,
      strategy,
      settings: event.data.settings
    });
    self.postMessage({ ok: true, result, strategyId: strategy.id });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
