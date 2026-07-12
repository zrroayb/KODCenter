import { describe, expect, it } from "vitest";
import { createDemoContexts } from "../data/demoData";
import { journalInsights } from "../lib/journal/journalAnalyzer";
import { upsertJournalEntry } from "../lib/journal/localJournal";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";

describe("local journal helpers", () => {
  it("upserts signal notes and derives strategy insights", () => {
    const signal = kodStrategy.scan({ context: createDemoContexts()[0], settings: kodStrategy.defaultSettings }).signals[0];
    const entries = upsertJournalEntry([], signal, {
      notes: "Stop fazla dardı, HTF ters kaldı.",
      tradeAction: "taken",
      actualEntry: signal.plan.entry,
      actualExit: signal.direction === "long" ? signal.plan.entry + signal.plan.riskDistance : signal.plan.entry - signal.plan.riskDistance,
      riskPct: 0.5,
      positionSize: 1,
      rMultiple: 1,
      mistake: "stop dar",
      executionQuality: "erken",
      result: "loss",
      ruleViolations: ["HTF Bias"]
    });
    const insights = journalInsights(entries);

    expect(entries).toHaveLength(1);
    expect(entries[0].notes).toContain("Stop");
    expect(entries[0].tradeAction).toBe("taken");
    expect(entries[0].actualEntry).toBe(signal.plan.entry);
    expect(entries[0].rMultiple).toBe(1);
    expect(entries[0].setupKey).toBeTruthy();
    expect(entries[0].signalSnapshot?.score).toBe(signal.score);
    expect(entries[0].latestSignalSnapshot?.checklist.length).toBeGreaterThan(0);
    expect(entries[0].history).toHaveLength(1);
    expect(insights.map((item) => item.value)).toContain("stop dar");
    expect(insights.map((item) => item.value)).toContain("HTF Bias");
    expect(insights.map((item) => item.label)).toContain("Alınan işlem");
    expect(insights.map((item) => item.value)).toContain("1.00R");
  });

  it("keeps one open journal row across refreshed signal ids and records action history", () => {
    const signal = kodStrategy.scan({ context: createDemoContexts()[0], settings: kodStrategy.defaultSettings }).signals[0];
    const watched = upsertJournalEntry([], signal, { tradeAction: "watch", result: "open", notes: "İzliyorum" });
    const refreshed = { ...signal, id: `${signal.id}-next-candle`, score: signal.score + 1 };
    const stopped = upsertJournalEntry(watched, refreshed, {
      tradeAction: "taken",
      result: "loss",
      actualEntry: signal.plan.entry,
      actualExit: signal.plan.stopLoss,
      rMultiple: -1
    });

    expect(stopped).toHaveLength(1);
    expect(stopped[0].tradeId).toBe(signal.id);
    expect(stopped[0].result).toBe("loss");
    expect(stopped[0].rMultiple).toBe(-1);
    expect(stopped[0].history?.map((event) => `${event.action}:${event.result}`)).toEqual(["watch:open", "taken:loss"]);
    expect(stopped[0].signalSnapshot?.score).toBe(signal.score);
    expect(stopped[0].latestSignalSnapshot?.score).toBe(signal.score + 1);
  });
});
