import { describe, expect, it } from "vitest";
import { attachSmtDivergences } from "../lib/intelligence/smtEngine";
import { buildMarketContext } from "../lib/intelligence/marketContext";
import { signalAlertChartSvg } from "../lib/telegram/alertChartSvg";
import { createDemoMarkets } from "../data/demoData";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";

function crtSignal() {
  const ctx = attachSmtDivergences(createDemoMarkets().map((m) => buildMarketContext(m.symbol, m.timeframes))).find(
    (c) => c.symbol === "USDJPY"
  );
  if (!ctx) throw new Error("USDJPY fixture missing");
  const signal = crtStrategy.scan({ context: ctx, settings: { ...crtStrategy.defaultSettings, minimumRR: 1.5 } }).signals[0];
  if (!signal?.crtAnchor) throw new Error("CRT signal fixture missing");
  return signal;
}

describe("alert chart svg (server-side, react-free)", () => {
  it("renders a standalone SVG with range + entry/stop levels", () => {
    const rendered = signalAlertChartSvg(crtSignal());
    expect(rendered?.svg.startsWith("<svg")).toBe(true);
    expect(rendered?.svg).toContain("xmlns=");
    expect(rendered?.svg).toContain("RANGE H");
    expect(rendered?.svg).toContain("GIRIS");
    expect(rendered?.svg).toContain("STOP");
    expect(rendered?.label).toContain("CRT");
  });
});
