import { describe, expect, it } from "vitest";
import type { TradingSignal } from "../lib/ict/types";
import { signalSetupIdentity } from "../lib/signals/setupIdentity";
import {
  matchingSignalForAlert,
  TELEGRAM_ALERT_RETENTION_MS,
  reconcileTelegramAlertHistory,
  saveTelegramAlertHistory,
  upsertTelegramAlertRecord
} from "../lib/telegram/alertHistory";
import type { TelegramAlertRecord } from "../lib/telegram/alertPayload";

function record(sentAt: number): TelegramAlertRecord {
  return {
    dedupeKey: "xau-short-ready",
    signalId: "xau-short",
    symbol: "XAUUSD",
    direction: "short",
    grade: "A",
    score: 84,
    sentAt,
    createdAt: sentAt,
    entry: 2400,
    stopLoss: 2410,
    targets: [2380, 2360],
    rr: 2,
    reasons: ["CRT sıra tamam"],
    alertKind: "ready",
    currentStage: "ready"
  };
}

function signal(stage: TradingSignal["stage"]): TradingSignal {
  return { id: "xau-short", stage } as TradingSignal;
}

describe("Telegram alert history", () => {
  it("keeps a sent alert visible and updates its latest signal state", () => {
    const now = 100_000;
    const next = reconcileTelegramAlertHistory([record(now - 1_000)], [signal("missed")], now, []);

    expect(next).toHaveLength(1);
    expect(next[0].currentStage).toBe("missed");
    expect(next[0].lastSeenAt).toBe(now);
  });

  it("retains the sent plan when it is absent from the latest scan", () => {
    const now = 100_000;
    const next = reconcileTelegramAlertHistory([record(now - 1_000)], [], now, []);

    expect(next).toHaveLength(1);
    expect(next[0].entry).toBe(2400);
    expect(next[0].currentStage).toBe("ready");
  });

  it("removes alerts after 24 hours", () => {
    const now = TELEGRAM_ALERT_RETENTION_MS + 5_000;
    const next = saveTelegramAlertHistory([record(1_000)], now);

    expect(next).toEqual([]);
  });

  it("upserts the same Telegram setup instead of duplicating it", () => {
    const first = record(10_000);
    const second = { ...record(20_000), currentStage: "watch" as const };
    const next = upsertTelegramAlertRecord([first], second, 20_000);

    expect(next).toHaveLength(1);
    expect(next[0].sentAt).toBe(20_000);
    expect(next[0].currentStage).toBe("watch");
  });

  it("matches the same CRT setup after its runtime id and plan change", () => {
    const refreshed = {
      id: "xau-short-refreshed",
      strategyId: "crt",
      symbol: "XAUUSD",
      direction: "short",
      stage: "watch",
      evidence: [],
      crtAnchor: {
        rangeTf: "4h",
        confirmTf: "15m",
        raidActive: true,
        raidClosed: true,
        rangeHigh: 2410,
        rangeLow: 2360,
        origin: "standard"
      }
    } as unknown as TradingSignal;
    const stored = {
      ...record(10_000),
      signalId: "old-runtime-id",
      dedupeKey: "old-plan-dedupe",
      setupKey: signalSetupIdentity(refreshed)
    };

    expect(matchingSignalForAlert(stored, [refreshed])).toBe(refreshed);
  });
});
