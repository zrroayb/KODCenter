import { describe, expect, it } from "vitest";
import { MARKET_SYMBOLS, SYMBOL_SPEC } from "../lib/ict/symbolSpec";
import { YAHOO_SYMBOLS } from "../lib/data/yahooProvider";
import { calculatePositionSize } from "../lib/risk/positionSizing";
import { defaultAccountModel } from "../lib/risk/accountModel";

describe("symbol spec (tek tablo)", () => {
  it("covers every symbol with sane, positive values", () => {
    for (const symbol of MARKET_SYMBOLS) {
      const spec = SYMBOL_SPEC[symbol];
      expect(spec.minBuffer).toBeGreaterThan(0);
      expect(spec.spread).toBeGreaterThan(0);
      expect(spec.pointValue).toBeGreaterThan(0);
      expect(spec.smtPartners).not.toContain(symbol);
      for (const partner of spec.smtPartners) expect(SYMBOL_SPEC[partner]).toBeDefined();
    }
  });

  it("feeds the Yahoo symbol list", () => {
    expect(YAHOO_SYMBOLS.map((item) => item.symbol)).toEqual(MARKET_SYMBOLS);
    expect(YAHOO_SYMBOLS.find((item) => item.symbol === "USDJPY")?.yahoo).toBe("JPY=X");
  });

  it("flags approximate point values so size reads as units, not lots", () => {
    const base = { account: defaultAccountModel, entry: 100, stopLoss: 99, target: 102 };
    const gold = calculatePositionSize({ ...base, symbol: "XAUUSD" });
    const btc = calculatePositionSize({ ...base, symbol: "BTCUSD" });
    expect(gold.approximate).toBe(true);
    expect(gold.warnings.some((warning) => warning.includes("birim"))).toBe(true);
    expect(btc.approximate).toBe(false);
  });
});
