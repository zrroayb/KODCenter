import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionSetupsView } from "../components/SessionSetupsView";
import type { SessionSetup } from "../lib/session/types";

const fixture = {
  id: "EURUSD:session-ui",
  setupFamily: "CRT_SESSION",
  setupModel: "ASIA_RANGE_LONDON_LOW_SWEEP_BULLISH_CRT",
  referenceSession: "ASIA",
  triggerSession: "LONDON",
  confirmationSession: "LONDON",
  direction: "long",
  lifecycleStatus: "WAITING_FOR_LTF_CONFIRMATION",
  grade: "A",
  score: 78,
  symbol: "EURUSD",
  timeframe: "15m",
  confirmationTimeframe: "15m",
  tradingDayId: "2026-07-16",
  sessionProfileId: "eurusd_default_v1",
  sessionProfileVersion: "1.0.0",
  detectorVersion: "1",
  promptVersion: "1",
  createdAt: 1,
  updatedAt: 2,
  referenceRangeId: "asia",
  referenceRange: { high: 1.102, low: 1.099, midpoint: 1.1005, quality: "normal", startsAt: 1, endsAt: 2 },
  currentPrice: 1.1002,
  sweptSide: "LOW",
  htfAlignment: "strong",
  scoreBreakdown: {
    htfAlignment: 15,
    rangeQuality: 10,
    liquidityLevel: 10,
    sweepQuality: 15,
    reclaimQuality: 10,
    displacementQuality: 15,
    crtQuality: 5,
    ltfConfirmation: 0,
    targetQuality: 5,
    timingQuality: 5,
    penalties: 0
  },
  events: [
    { id: "range", kind: "range", status: "pass", label: "Asia range", detail: "Range locked" },
    { id: "confirm", kind: "ltf-confirmation", status: "pending", label: "CRT confirmation", detail: "15m confirmation pending" }
  ],
  warnings: [],
  blockers: ["15m confirmation pending"],
  summary: "LTF confirmation pending"
} as SessionSetup;

describe("Session Setups UI", () => {
  it("renders one active decision, range map and the missing step", () => {
    const html = renderToStaticMarkup(<SessionSetupsView logs={[]} onOpenSignal={() => undefined} setups={[fixture]} />);
    expect(html).toContain("Session radar");
    expect(html).toContain("Aktif (1)");
    expect(html).toContain("ASIA");
    expect(html).toContain("LONDON");
    expect(html).toContain("Kapanış bekle");
    expect(html).toContain("Tek beklenen");
    expect(html).toContain("15m confirmation pending");
    expect(html).toContain("session-range-map");
    expect(html).toContain("Teknik detay");
  });
});
