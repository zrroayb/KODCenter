/// <reference lib="webworker" />

import { managementDecision, managementScenarios, runMonthlyRuntimeReplay } from "../lib/backtest/runtimeReplay";
import { mergeReplayArchive, type ReplayArchive } from "../lib/backtest/replayArchive";
import { getStrategy } from "../lib/strategies/registry";
import type { DemoMarket } from "../data/demoData";
import type { StrategySettings } from "../lib/strategies/types";

type ReplayRequest = {
  markets: DemoMarket[];
  settings: StrategySettings;
  // Hangi playbook ölçülüyor: "crt". Boşsa CRT.
  strategyId?: string;
  // Browser-stored archive of earlier replays' resolved trades (localStorage is not reachable
  // from a worker, so App sends it in and saves the merged copy that comes back).
  archive?: ReplayArchive;
};

self.onmessage = (event: MessageEvent<ReplayRequest>) => {
  try {
    const strategy = getStrategy(event.data.strategyId ?? "crt");
    const result = runMonthlyRuntimeReplay({
      markets: event.data.markets,
      strategy,
      settings: event.data.settings
    });
    const archive = mergeReplayArchive(event.data.archive, result.replay?.trades ?? []);
    if (result.replay) {
      // Exit-model decision runs on the larger of: this replay, or the accumulated archive.
      const thisReplay = result.replay.managementDecision?.sample ?? 0;
      const archived = managementScenarios(archive.trades, event.data.settings);
      const archivedSample = archived.find((item) => item.live)?.trades ?? 0;
      if (archivedSample > thisReplay) {
        result.replay.managementScenarios = archived;
        result.replay.managementDecision = managementDecision(archived);
      }
      result.replay.exitSample = {
        trades: Math.max(archivedSample, thisReplay),
        since: archivedSample > thisReplay ? archive.trades.at(-1)?.signalTime : undefined,
        archived: archivedSample > thisReplay
      };
    }
    self.postMessage({ ok: true, result, strategyId: strategy.id, archive });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
