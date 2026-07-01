import { describe, expect, it } from "vitest";
import { defaultAccountModel } from "../lib/risk/accountModel";
import { calculatePositionSize } from "../lib/risk/positionSizing";

describe("risk engine", () => {
  it("calculates risk amount, position size, potential gain, and RR", () => {
    const result = calculatePositionSize({
      account: defaultAccountModel,
      symbol: "NAS100",
      entry: 100,
      stopLoss: 95,
      target: 110,
      pointValue: 1
    });

    expect(result.riskAmount).toBe(100);
    expect(result.riskDistance).toBe(5);
    expect(result.positionSize).toBe(20);
    expect(result.potentialLoss).toBe(100);
    expect(result.potentialGain).toBe(200);
    expect(result.rr).toBe(2);
    expect(result.warnings).toEqual([]);
  });
});
