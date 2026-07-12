/// <reference lib="webworker" />

import { runMonthlyRuntimeReplay } from "../lib/backtest/runtimeReplay";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";
import type { DemoMarket } from "../data/demoData";
import type { StrategySettings } from "../lib/strategies/types";

type ReplayRequest = {
  markets: DemoMarket[];
  settings: StrategySettings;
};

self.onmessage = (event: MessageEvent<ReplayRequest>) => {
  try {
    const result = runMonthlyRuntimeReplay({
      markets: event.data.markets,
      strategy: crtStrategy,
      settings: event.data.settings
    });
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
