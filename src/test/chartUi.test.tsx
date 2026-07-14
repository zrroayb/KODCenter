import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandleChart } from "../components/CandleChart";
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

  it("renders entry, stop, exit, risk area and stop reason for the selected signal", () => {
    const context = createStructureContext({
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
      fairValueGaps: [{ direction: "short", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: false }]
    });
    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];

    const markup = renderToStaticMarkup(
      <CandleChart
        candles={context.timeframes.m15}
        context={context}
        mode="execution"
        selectedSignal={signal}
        signals={[signal]}
        title="XAUUSD execution"
      />
    );

    expect(markup).toContain("ENTRY");
    expect(markup).toContain("STOP");
    expect(markup).toContain("TP1");
    expect(markup).toContain("1R RISK");
    expect(markup).toContain("sweep üstü");
    expect(markup).toContain("TEK KARAR");
  });

  it("renders compact entry, stop and TP markers on higher timeframe charts", () => {
    const context = createStructureContext({
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
      fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: false }]
    });
    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];

    const higherTimeframes = [
      { candles: context.timeframes.h1, mode: "confirmation" as const, title: "XAUUSD 1h confirmation" },
      { candles: context.timeframes.h4, mode: "context" as const, title: "XAUUSD 4h structure" },
      { candles: context.timeframes.daily, mode: "daily" as const, title: "XAUUSD 1D dealing range" }
    ];

    for (const timeframe of higherTimeframes) {
      const markup = renderToStaticMarkup(
        <CandleChart
          candles={timeframe.candles}
          context={context}
          mode={timeframe.mode}
          selectedSignal={signal}
          signals={[signal]}
          title={timeframe.title}
        />
      );

      expect(markup).toContain("HTF GİRİŞ");
      expect(markup).toContain("HTF STOP");
      expect(markup).toContain("HTF EQ/TP1");
      expect(markup).toContain("HTF DOL/TP2");
      expect(markup).not.toContain("RİSK ALANI");
    }
  });

  it("does not render a context-only FVG when the selected plan does not use it", () => {
    const context = createStructureContext({
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
      fairValueGaps: []
    });
    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];
    const contextOnlyGap = { direction: "short" as const, low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: false };
    const signalWithContextGap = {
      ...signal,
      context: {
        ...signal.context,
        fairValueGaps: [contextOnlyGap]
      }
    };

    const markup = renderToStaticMarkup(
      <CandleChart
        candles={context.timeframes.m15}
        context={signalWithContextGap.context}
        mode="execution"
        selectedSignal={signalWithContextGap}
        signals={[signalWithContextGap]}
        title="XAUUSD execution"
      />
    );

    expect(signal.plan.entryModel.fairValueGap).toBeUndefined();
    expect(markup).not.toContain(">FVG<");
    expect(markup).not.toContain("FVG retest");
  });

  it("labels the selected inverse gap as iFVG when the plan uses an iFVG retest", () => {
    const context = createStructureContext({
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 23 }],
      fairValueGaps: [{ direction: "long", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: true }]
    });
    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];

    const markup = renderToStaticMarkup(
      <CandleChart
        candles={context.timeframes.m15}
        context={context}
        mode="execution"
        selectedSignal={signal}
        signals={[signal]}
        title="XAUUSD execution"
      />
    );

    expect(signal.plan.entrySource).toBe("ifvg-retest");
    expect(markup).toContain("iFVG retest");
  });

  it("renders the exact candle close level needed for a watch signal", () => {
    const base = createStructureContext();
    const m15 = base.timeframes.m15.map((candle, index) =>
      index === base.timeframes.m15.length - 1 ? { ...candle, low: 98.8 } : candle
    );
    const context = createStructureContext({
      timeframes: { ...base.timeframes, m15, m5: m15 },
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 23, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 23, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [],
      fairValueGaps: [{ direction: "short", low: 99.8, high: 100.2, midpoint: 100, candleIndex: 22, mitigated: false }]
    });
    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];

    const markup = renderToStaticMarkup(
      <CandleChart
        candles={context.timeframes.m15}
        context={context}
        mode="execution"
        selectedSignal={signal}
        signals={[signal]}
        title="XAUUSD execution"
      />
    );

    expect(signal.stage).toBe("watch");
    expect(markup).toContain("kapanış onayı · 15m");
    expect(markup).toContain("98.80");
    expect(markup).toContain("referans mum");
    expect(markup).toContain("kapanış onayı");
    expect(markup).toContain("TEK KARAR");
    expect(markup).toContain("Son kapalı mum low güçlü kapanışla kırılmalı");
    expect(markup).toContain("MANIPULATION");
    expect(markup).not.toContain("NYAM.H");
    expect(markup).not.toContain("NYAM.L");
  });

  it("renders a clear invalidated badge when stop has already been touched", () => {
    const base = createStructureContext();
    const m15 = base.timeframes.m15.map((candle, index) =>
      index === base.timeframes.m15.length - 1 ? { ...candle, high: 102.2, close: 100 } : candle
    );
    const context = createStructureContext({
      timeframes: { ...base.timeframes, m15, m5: m15 },
      sweeps: [{ side: "buy-side", level: 101, candleIndex: 22, reclaimed: true }],
      displacements: [{ direction: "short", candleIndex: 22, bodyRatio: 0.8, rangeAtr: 1 }],
      marketStructureShifts: [{ direction: "short", level: 99.8, candleIndex: 22 }],
      fairValueGaps: [{ direction: "short", low: 100.2, high: 100.7, midpoint: 100.45, candleIndex: 22, mitigated: false }]
    });
    const signal = kodStrategy.scan({ context, settings: { ...kodStrategy.defaultSettings, minimumRR: 0.1 } }).signals[0];

    const markup = renderToStaticMarkup(
      <CandleChart
        candles={context.timeframes.m15}
        context={context}
        mode="execution"
        selectedSignal={signal}
        signals={[signal]}
        title="XAUUSD execution"
      />
    );

    expect(signal.stage).toBe("invalidated");
    expect(markup).toContain("INVALIDATED · STOP GÖRÜLDÜ");
    expect(markup).toContain("STOP HIT");
  });
});
