import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignalDetailsPanel } from "../components/SignalDetailsPanel";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";
import { createStructureContext } from "./strategyFixtures";

describe("chart trade plan overlay", () => {
  it("shows one-tap journal actions for every selected setup", () => {
    const context = createStructureContext();
    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];
    const markup = renderToStaticMarkup(
      <SignalDetailsPanel signal={signal} onClear={() => undefined} onSaveJournal={() => undefined} />
    );

    expect(markup).toContain("Aldım");
    expect(markup).toContain("Almadım");
    expect(markup).toContain("Stop oldu");
    expect(markup).toContain("Not ve sonuç detayı");
  });
});
