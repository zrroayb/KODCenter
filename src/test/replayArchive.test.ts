import { describe, expect, it } from "vitest";
import type { RuntimeReplayTrade } from "../lib/analytics/performance";
import { mergeReplayArchive, REPLAY_ARCHIVE_VERSION } from "../lib/backtest/replayArchive";

const trade = (signalTime: number, status: RuntimeReplayTrade["status"], entry = 1.1, rMultiple = 1) => ({
  id: `t-${signalTime}-${Math.random()}`, symbol: "EURUSD", direction: "long", signalTime, entry, stopLoss: 1.09, status, rMultiple,
  managementVariants: { dolBe: rMultiple, eqFull: 0.5, eqPartialBe: 0.7, noBe: 0.6 }
}) as unknown as RuntimeReplayTrade;

describe("replay archive (sample grows past Yahoo's 60-day 15m window)", () => {
  it("keeps only resolved trades, dedupes the same plan across replays and keeps newest first", () => {
    const first = mergeReplayArchive(undefined, [trade(1, "tp2", 1.1), trade(2, "open", 1.2), trade(3, "not-triggered", 1.3)]);
    expect(first.trades.map((t) => t.signalTime)).toEqual([1]);
    // Same plan seen again by a later replay (different id/scan time) replaces, not duplicates.
    const second = mergeReplayArchive(first, [trade(1, "tp2", 1.1, 3), trade(5, "stopped", 1.15, -1)]);
    expect(second.trades.map((t) => t.signalTime)).toEqual([5, 1]);
    expect(second.trades.find((t) => t.signalTime === 1)?.rMultiple).toBe(3);
    expect(second.version).toBe(REPLAY_ARCHIVE_VERSION);
  });

  it("drops an archive from another engine version and respects the cap", () => {
    const stale = { version: "old-engine", trades: [trade(1, "tp2")] };
    expect(mergeReplayArchive(stale, []).trades).toEqual([]);
    const many = Array.from({ length: 10 }, (_, i) => trade(i, "stopped", 1 + i / 100, -1));
    expect(mergeReplayArchive(undefined, many, 4).trades.map((t) => t.signalTime)).toEqual([9, 8, 7, 6]);
  });
});
