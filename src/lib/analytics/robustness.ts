import { equityCurveFromReturns, maxDrawdown } from "./performance";

// Backtest disiplini: tek bir toplam-R sayısı yalan söyler. Bir edge, ya (a) tüm alt-dönemlerde mi
// tutuyor yoksa tek şanslı bir seride mi yoğunlaştı (walk-forward), ve (b) işlem sırası biraz farklı
// gelişseydi sonuç dağılımı ne olurdu / en kötü drawdown / iflas riski nedir (Monte-Carlo) — bunları
// ölçer. Girdi: kronolojik sıradaki işlem R-çokluları. Harici bağımlılık yok, deterministik (tohumlu).

function expectancy(rs: number[]): number {
  return rs.length ? rs.reduce((sum, r) => sum + r, 0) / rs.length : 0;
}

function profitFactor(rs: number[]): number {
  const grossWin = rs.filter((r) => r > 0).reduce((sum, r) => sum + r, 0);
  const grossLoss = Math.abs(rs.filter((r) => r < 0).reduce((sum, r) => sum + r, 0));
  if (grossLoss === 0) return grossWin > 0 ? Infinity : 0;
  return grossWin / grossLoss;
}

function winRatePct(rs: number[]): number {
  if (!rs.length) return 0;
  return (rs.filter((r) => r > 0).length / rs.length) * 100;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function quantile(sortedAsc: number[], q: number): number {
  if (!sortedAsc.length) return 0;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

// ---- Walk-forward (dönem-kararlılığı) -------------------------------------------------------------

export type WalkForwardFold = {
  index: number;
  trades: number;
  totalR: number;
  expectancyR: number;
  winRatePct: number;
  profitFactor: number;
  positive: boolean;
};

export type WalkForwardResult = {
  folds: WalkForwardFold[];
  totalTrades: number;
  positiveFolds: number;
  expectancyStdev: number;
  // "robust": edge dönemlere yayılmış; "fragile": edge tek/az döneme sıkışmış; "insufficient": az örneklem.
  verdict: "robust" | "fragile" | "insufficient";
  summary: string;
};

// Kronolojik R serisini `folds` bitişik dilime böl; her dilimin (out-of-sample penceresi gibi)
// beklentisini ölç. Edge tek şanslı stretch mi yoksa dönemlere yayılmış mı görünür.
export function walkForwardAnalysis(rs: number[], options: { folds?: number } = {}): WalkForwardResult {
  const folds = Math.max(2, options.folds ?? 5);
  const minPerFold = 3;

  if (rs.length < folds * minPerFold) {
    return {
      folds: [],
      totalTrades: rs.length,
      positiveFolds: 0,
      expectancyStdev: 0,
      verdict: "insufficient",
      summary: `yetersiz örneklem: ${folds} dilim için ≥${folds * minPerFold} işlem gerek, ${rs.length} var`
    };
  }

  const size = Math.floor(rs.length / folds);
  const result: WalkForwardFold[] = [];
  for (let i = 0; i < folds; i++) {
    const start = i * size;
    const slice = i === folds - 1 ? rs.slice(start) : rs.slice(start, start + size);
    const exp = expectancy(slice);
    result.push({
      index: i + 1,
      trades: slice.length,
      totalR: Number(slice.reduce((sum, r) => sum + r, 0).toFixed(3)),
      expectancyR: Number(exp.toFixed(3)),
      winRatePct: Number(winRatePct(slice).toFixed(1)),
      profitFactor: Number(profitFactor(slice).toFixed(2)),
      positive: exp > 0
    });
  }

  const positiveFolds = result.filter((f) => f.positive).length;
  const expStdev = stdev(result.map((f) => f.expectancyR));
  const positiveRatio = positiveFolds / folds;
  const verdict: WalkForwardResult["verdict"] = positiveRatio >= 0.8 ? "robust" : positiveRatio <= 0.5 ? "fragile" : "fragile";

  return {
    folds: result,
    totalTrades: rs.length,
    positiveFolds,
    expectancyStdev: Number(expStdev.toFixed(3)),
    verdict,
    summary: `${positiveFolds}/${folds} dilim pozitif · beklenti sapması ${expStdev.toFixed(2)}R → ${verdict === "robust" ? "dönemlere yayılmış edge" : "kırılgan, edge birkaç döneme sıkışmış"}`
  };
}

// ---- Monte-Carlo (bootstrap) ----------------------------------------------------------------------

// Tohumlu deterministik PRNG (mulberry32) — testler stabil olsun.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type MonteCarloResult = {
  runs: number;
  trades: number;
  finalR: { p5: number; p50: number; p95: number; mean: number };
  maxDrawdownR: { p50: number; p95: number; worst: number };
  probProfit: number; // final R > 0 çıkan koşuların oranı (0..1)
  probOfRuin?: number; // ruinThresholdR verilirse: cari eşitlik bu eşiğe değen koşuların oranı
  summary: string;
};

// R serisini `runs` kez yerine-koymalı yeniden örnekle (bootstrap), her koşu bir eşitlik eğrisi üretir;
// nihai R ve maksimum drawdown dağılımlarını yüzdeliklerle özetle. Kâr olasılığı = final>0 oranı.
export function monteCarloAnalysis(
  rs: number[],
  options: { runs?: number; seed?: number; ruinThresholdR?: number } = {}
): MonteCarloResult {
  const runs = Math.max(1, options.runs ?? 5000);
  const rand = mulberry32(options.seed ?? 1);
  const n = rs.length;

  const finals: number[] = [];
  const drawdowns: number[] = [];
  let profitable = 0;
  let ruined = 0;
  const ruin = options.ruinThresholdR;

  if (n === 0) {
    return {
      runs: 0,
      trades: 0,
      finalR: { p5: 0, p50: 0, p95: 0, mean: 0 },
      maxDrawdownR: { p50: 0, p95: 0, worst: 0 },
      probProfit: 0,
      summary: "işlem yok"
    };
  }

  for (let run = 0; run < runs; run++) {
    const sample: number[] = new Array(n);
    for (let i = 0; i < n; i++) sample[i] = rs[Math.floor(rand() * n)];
    const curve = equityCurveFromReturns(sample);
    const final = curve[curve.length - 1];
    finals.push(final);
    drawdowns.push(maxDrawdown(curve));
    if (final > 0) profitable++;
    if (ruin !== undefined && Math.min(...curve) <= ruin) ruined++;
  }

  const finalsSorted = [...finals].sort((a, b) => a - b);
  const ddSorted = [...drawdowns].sort((a, b) => a - b);
  const mean = finals.reduce((sum, v) => sum + v, 0) / runs;

  const result: MonteCarloResult = {
    runs,
    trades: n,
    finalR: {
      p5: Number(quantile(finalsSorted, 0.05).toFixed(2)),
      p50: Number(quantile(finalsSorted, 0.5).toFixed(2)),
      p95: Number(quantile(finalsSorted, 0.95).toFixed(2)),
      mean: Number(mean.toFixed(2))
    },
    maxDrawdownR: {
      p50: Number(quantile(ddSorted, 0.5).toFixed(2)),
      p95: Number(quantile(ddSorted, 0.95).toFixed(2)),
      worst: Number(ddSorted[ddSorted.length - 1].toFixed(2))
    },
    probProfit: Number((profitable / runs).toFixed(3)),
    summary: ""
  };
  if (ruin !== undefined) result.probOfRuin = Number((ruined / runs).toFixed(3));

  result.summary =
    `kâr olasılığı ${(result.probProfit * 100).toFixed(0)}% · final R p5/p50/p95 ` +
    `${result.finalR.p5}/${result.finalR.p50}/${result.finalR.p95} · en kötü %5 drawdown ${result.maxDrawdownR.p95}R` +
    (result.probOfRuin !== undefined ? ` · iflas riski ${(result.probOfRuin * 100).toFixed(1)}%` : "");

  return result;
}
