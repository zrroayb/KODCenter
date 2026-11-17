import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DemoMarket } from "../data/demoData";
import type { Candle } from "../lib/ict/types";
import { detectAnchorRaid } from "../lib/strategies/crt/crt.strategy";

// Owner-labelled CRT examples (src/test/fixtures/LABELED_CRT.md). Empty file → skipped.
type Label = { symbol: string; rangeTf: "4h" | "1d" | "1w" | "1M"; c1Time: string; direction?: "long" | "short"; crt: boolean; note?: string };

const here = dirname(fileURLToPath(import.meta.url));
const labels = JSON.parse(readFileSync(join(here, "fixtures/labeledCrt.json"), "utf8")) as Label[];
const marketsPath = join(here, "fixtures/labeledCrtMarkets.json");

function rangeCandles(market: DemoMarket, tf: Label["rangeTf"]): Candle[] {
  return tf === "4h" ? market.timeframes.h4 : tf === "1d" ? market.timeframes.daily : tf === "1w" ? market.timeframes.weekly : market.timeframes.monthly;
}

// Engine sees a CRT on this C1 if, at some point within its raid window, detectAnchorRaid returns
// a raid whose range is exactly that candle and whose C2 closed back inside.
export function engineSeesCrt(candles: Candle[], c1Index: number, direction?: "long" | "short"): boolean {
  const c1 = candles[c1Index];
  for (let end = c1Index + 2; end <= Math.min(candles.length, c1Index + 8); end += 1) {
    const slice = candles.slice(0, end).map((candle) => ({ ...candle, closed: true }));
    const read = detectAnchorRaid(slice, { rangeTf: "4h", confirmTf: "15m" });
    if (read.raid?.closed && read.range.high === c1.high && read.range.low === c1.low && (!direction || read.raid.direction === direction)) return true;
  }
  return false;
}

describe("owner-labelled CRT examples", () => {
  it("label file is valid", () => {
    for (const label of labels) {
      expect(typeof label.symbol).toBe("string");
      expect(["4h", "1d", "1w", "1M"]).toContain(label.rangeTf);
      expect(Number.isFinite(Date.parse(label.c1Time))).toBe(true);
      expect(typeof label.crt).toBe("boolean");
    }
  });

  it.skipIf(labels.length === 0)("engine CRT detection agrees with every owner label", () => {
    expect(existsSync(marketsPath), "labeledCrtMarkets.json yok: CRT funnel workflow'unun markets.json çıktısını buraya koy").toBe(true);
    const markets = JSON.parse(readFileSync(marketsPath, "utf8")) as DemoMarket[];
    const disagreements: string[] = [];
    for (const label of labels) {
      const market = markets.find((item) => item.symbol === label.symbol);
      const candles = market ? rangeCandles(market, label.rangeTf) : [];
      const c1Index = candles.findIndex((candle) => candle.time === Date.parse(label.c1Time));
      if (c1Index < 0) {
        disagreements.push(`${label.symbol} ${label.rangeTf} ${label.c1Time}: C1 mumu veride yok`);
        continue;
      }
      const engine = engineSeesCrt(candles, c1Index, label.direction);
      if (engine !== label.crt) disagreements.push(`${label.symbol} ${label.rangeTf} ${label.c1Time}: etiket ${label.crt ? "CRT" : "değil"}, motor ${engine ? "CRT" : "değil"}${label.note ? ` (${label.note})` : ""}`);
    }
    expect(disagreements).toEqual([]);
  });
});

describe("engineSeesCrt helper", () => {
  const bar = (index: number, open: number, high: number, low: number, close: number): Candle => ({ time: index, open, high, low, close, volume: 1, closed: true });
  it("finds a textbook CRT and rejects an acceptance close", () => {
    const crt = [bar(0, 98, 99, 97, 98), bar(1, 96, 101, 95, 100), bar(2, 100, 101.6, 99, 99.5), bar(3, 99.5, 99.8, 97, 97.5)];
    expect(engineSeesCrt(crt, 1, "short")).toBe(true);
    const accepted = [bar(0, 98, 99, 97, 98), bar(1, 96, 101, 95, 100), bar(2, 100, 102, 99.8, 101.8), bar(3, 101.8, 101.9, 98.5, 99)];
    expect(engineSeesCrt(accepted, 1, "short")).toBe(false);
  });
});
