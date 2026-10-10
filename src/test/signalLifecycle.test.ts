import { describe, expect, it } from "vitest";
import { signalDecisionClass, signalDecisionLabel } from "../lib/signals/signalClassification";
import { createCrtSignal } from "./strategyFixtures";

describe("signal decision class", () => {
  it("a confirmed CRT READY is tradeable", async () => {
    const signal = await createCrtSignal();
    expect(signalDecisionClass(signal)).toBe("tradeable");
    expect(signalDecisionLabel(signal)).toBe("ALINABİLİR");
  });

  it("separates terminal structure contradictions from ordinary watch requirements", async () => {
    const signal = await createCrtSignal({ exitMinimumRR: 10 });
    expect(signalDecisionClass(signal)).not.toBe("invalid");
    const invalid = {
      ...signal,
      stage: "watch" as const,
      governance: {
        ...signal.governance,
        blockers: ["HTF continuation kapanışı ters yönde; range close ile kırılmış, bu range'den reversal alınmaz."]
      }
    };
    expect(signalDecisionClass(invalid)).toBe("invalid");
    expect(signalDecisionLabel(invalid)).toBe("GEÇERSİZ");
  });
});
