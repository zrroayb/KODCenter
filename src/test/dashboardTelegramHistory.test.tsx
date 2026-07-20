import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FinanceDashboard } from "../App";
import type { TelegramAlertRecord } from "../lib/telegram/alertPayload";

describe("dashboard Telegram history", () => {
  it("keeps a previously sent XAUUSD SHORT visible with its latest status", () => {
    const alert: TelegramAlertRecord = {
      dedupeKey: "xau-short",
      signalId: "xau-short-signal",
      symbol: "XAUUSD",
      direction: "short",
      grade: "A",
      score: 84,
      sentAt: Date.now(),
      createdAt: Date.now(),
      entry: 2400,
      stopLoss: 2410,
      targets: [2380, 2360],
      rr: 2,
      reasons: ["CRT sırası tamam"],
      alertKind: "ready",
      currentStage: "missed"
    };
    const html = renderToStaticMarkup(
      <FinanceDashboard
        signals={[]}
        hiddenSignals={[]}
        rejectedSetups={[]}
        backtestResult={{ profitFactor: 0, totalTrades: 0 } as never}
        journalEntries={[]}
        dataHealth={{ status: "ok" } as never}
        sessionName="Outside"
        telegramAlerts={[alert]}
        onOpenChart={vi.fn()}
        onOpenTelegramAlert={vi.fn()}
        onRunScan={vi.fn()}
        onRunBacktest={vi.fn()}
      />
    );

    expect(html).toContain("Son uyarılar");
    expect(html).toContain("XAUUSD SHORT");
    expect(html).toContain("Giriş 2,400");
    expect(html).toContain("Kaçtı");
  });
});
