import { describe, expect, it } from "vitest";
import { attachSmtDivergences } from "../lib/intelligence/smtEngine";
import { buildMarketContext } from "../lib/intelligence/marketContext";
import { captureSignalChartImages, renderSignalChartSvg } from "../lib/telegram/chartSnapshot";
import { createDemoMarkets } from "../data/demoData";
import { crtStrategy } from "../lib/strategies/crt/crt.strategy";

function crtSignal() {
  const usdJpy = attachSmtDivergences(createDemoMarkets().map((market) => buildMarketContext(market.symbol, market.timeframes)))
    .find((context) => context.symbol === "USDJPY");
  if (!usdJpy) throw new Error("USDJPY fixture missing");
  const signal = crtStrategy.scan({ context: usdJpy, settings: { ...crtStrategy.defaultSettings, minimumRR: 1.5 } }).signals[0];
  if (!signal?.crtAnchor) throw new Error("CRT signal fixture missing");
  return signal;
}

describe("telegram chart snapshots", () => {
  it("renders standalone SVGs for the CRT range TF and the confirmation TF", () => {
    const signal = crtSignal();

    const range = renderSignalChartSvg(signal, "range");
    const confirm = renderSignalChartSvg(signal, "confirm");

    expect(range?.svg.startsWith("<svg")).toBe(true);
    expect(range?.svg).toContain("xmlns=");
    expect(range?.label).toContain("CRT range mumu");
    expect(range?.label).toContain(signal.crtAnchor!.rangeTf.toUpperCase());
    expect(confirm?.svg.startsWith("<svg")).toBe(true);
    expect(confirm?.label).toContain("onay grafiği");
    expect(confirm?.label).toContain(signal.crtAnchor!.confirmTf.toUpperCase());
  });

  it("returns no images outside the browser instead of throwing", async () => {
    const signal = crtSignal();

    await expect(captureSignalChartImages(signal)).resolves.toEqual([]);
  });
});
