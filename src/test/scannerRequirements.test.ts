import { describe, expect, it } from "vitest";
import { createDemoContexts } from "../data/demoData";
import { waitingRequirements } from "../components/ScannerView";
import { kodStrategy } from "../lib/strategies/kod/kod.strategy";

describe("scanner waiting requirements", () => {
  it("explains what a watch signal needs before it is tradeable", () => {
    const signal = kodStrategy.scan({ context: createDemoContexts()[0], settings: kodStrategy.defaultSettings }).signals[0];
    const watchSignal = {
      ...signal,
      stage: "watch" as const,
      context: {
        ...signal.context,
        sweeps: [],
        displacements: [],
        marketStructureShifts: [],
        fairValueGaps: []
      }
    };

    const requirements = waitingRequirements(watchSignal);

    expect(requirements.join(" ")).toContain("stoplar alınsın");
    expect(requirements.join(" ")).toContain("15m mum");
    expect(requirements.join(" ")).toContain("kapanmalı");
    expect(requirements.join(" ")).toContain("Son kapanmış mumun");
    expect(requirements.join(" ")).toContain("kapanış/onay modeliyle netleşsin");
    expect(requirements.join(" ")).not.toContain("giriş boşluğu");
  });

  it("does not describe invalidated signals as waiting trade candidates", () => {
    const signal = kodStrategy.scan({ context: createDemoContexts()[0], settings: kodStrategy.defaultSettings }).signals[0];
    const invalidatedSignal = {
      ...signal,
      stage: "invalidated" as const
    };

    expect(waitingRequirements(invalidatedSignal).join(" ")).toContain("Kovalamadan");
  });

  it("does not ask crypto signals to wait for a session", () => {
    const signal = kodStrategy.scan({ context: createDemoContexts()[0], settings: kodStrategy.defaultSettings }).signals[0];
    const cryptoWatch = {
      ...signal,
      symbol: "BTCUSD" as const,
      stage: "watch" as const,
      context: {
        ...signal.context,
        symbol: "BTCUSD" as const,
        killzones: [{ name: "Outside" as const, active: true, startHourUtc: 0, endHourUtc: 0 }]
      }
    };

    expect(waitingRequirements(cryptoWatch).join(" ")).not.toContain("Doğru saat");
  });
});
