import type { RuntimeReplayTrade } from "./performance";

// "Bu setup geçmişte neye benziyordu, o benzerler nasıl bitti?" — canlı bir kuruluma en yakın
// geçmiş kurulumları bulup gerçekleşen R sonuçlarını özetler. Vektör DB / HNSW / harici bağımlılık
// YOK: karpus birkaç yüz-birkaç bin işlem, doğrusal tarama + Gower karışık-tip mesafesi yeter ve
// kontrol tümüyle bizde kalır. Korpus runtimeReplay'in ürettiği RuntimeReplayTrade[]'idir; her işlem
// hem betimleyici alanları (yön, grade, seans, bias, premium/discount, rejim, rr) hem de sonucu
// (status, rMultiple) taşır — yani "benzer" ve "nasıl bitti" aynı kayıttan gelir.

// Karşılaştırma için bir kurulumdan ihtiyaç duyduğumuz alanlar. RuntimeReplayTrade bunları zaten
// karşılar; canlı bir TradingSignal için signalToSetupLike() best-effort doldurur.
export type SetupLike = {
  direction: string;
  grade: string;
  rr: number;
  eqRR?: number;
  score: number;
  session: string;
  regime: string;
  premiumDiscount: string;
  dailyBias: string;
  h4Bias: string;
  h1Bias: string;
};

// Betimleyici alanların mantıksal ağırlıkları — "setup'ın şekli" (yön, premium/discount, HTF bias,
// rr) gürültüden (score gibi) baskın olsun. Override edilebilir.
export type SimilarityWeights = {
  direction: number;
  premiumDiscount: number;
  dailyBias: number;
  h4Bias: number;
  h1Bias: number;
  rr: number;
  eqRR: number;
  grade: number;
  session: number;
  regime: number;
  score: number;
};

export const DEFAULT_SIMILARITY_WEIGHTS: SimilarityWeights = {
  direction: 1.6,
  premiumDiscount: 1.3,
  dailyBias: 1.2,
  h4Bias: 1.0,
  h1Bias: 0.8,
  rr: 1.0,
  eqRR: 0.7,
  grade: 0.8,
  session: 0.7,
  regime: 0.9,
  score: 0.5
};

const GRADE_ORDINAL: Record<string, number> = { A: 4, "A+": 4, B: 3, C: 2, D: 1 };

function directionSign(direction: string): number {
  const d = direction.toLowerCase();
  if (d.includes("long") || d.includes("buy") || d === "up") return 1;
  if (d.includes("short") || d.includes("sell") || d === "down") return -1;
  return 0;
}

// Bias metnini yöne göre "uyum" işaretine indir: +1 bias yönle aynı, -1 karşı, 0 nötr/bilinmiyor.
// Vokabülere bağımlı kalmadan (ingilizce/türkçe bull/bear/up/down/long/short) çalışır.
function biasSign(bias: string): number {
  const b = bias.toLowerCase();
  if (/(bull|long|up|yüks|alım|güçlü al)/.test(b)) return 1;
  if (/(bear|short|down|düş|satım|güçlü sat)/.test(b)) return -1;
  return 0;
}

function gradeOrdinal(grade: string): number {
  return GRADE_ORDINAL[grade?.toUpperCase?.() ?? ""] ?? 2;
}

type NumericField = "rr" | "eqRR" | "score";
const NUMERIC_FIELDS: NumericField[] = ["rr", "eqRR", "score"];

export type SetupSimilarityIndex = {
  ranges: Record<NumericField, { min: number; max: number }>;
  weights: SimilarityWeights;
};

function numericValue(setup: SetupLike, field: NumericField): number {
  if (field === "eqRR") return Number.isFinite(setup.eqRR) ? (setup.eqRR as number) : setup.rr;
  return Number(setup[field] ?? 0);
}

// Korpus üstünden sayısal alanların min/max aralığını çıkar (min-max normalizasyon için).
export function buildSetupSimilarityIndex(
  corpus: SetupLike[],
  weights: SimilarityWeights = DEFAULT_SIMILARITY_WEIGHTS
): SetupSimilarityIndex {
  const ranges = {
    rr: { min: Infinity, max: -Infinity },
    eqRR: { min: Infinity, max: -Infinity },
    score: { min: Infinity, max: -Infinity }
  } as Record<NumericField, { min: number; max: number }>;
  for (const setup of corpus) {
    for (const field of NUMERIC_FIELDS) {
      const value = numericValue(setup, field);
      if (value < ranges[field].min) ranges[field].min = value;
      if (value > ranges[field].max) ranges[field].max = value;
    }
  }
  for (const field of NUMERIC_FIELDS) {
    if (!Number.isFinite(ranges[field].min)) ranges[field] = { min: 0, max: 1 };
  }
  return { ranges, weights };
}

function normalizeNumeric(value: number, range: { min: number; max: number }): number {
  const span = range.max - range.min;
  if (span <= 0) return 0.5;
  return Math.min(1, Math.max(0, (value - range.min) / span));
}

// Gower benzeri karışık-tip ağırlıklı mesafe: sayısallar min-max normalize edilip farkın karesi,
// kategorikler eşit/değil ikili (0/1), yön ve bias sabit [-1,1] aralığında sayısal. 0 = birebir aynı.
export function setupDistance(a: SetupLike, b: SetupLike, index: SetupSimilarityIndex): number {
  const w = index.weights;
  let sum = 0;
  let wsum = 0;

  const add = (weight: number, diffSquared: number) => {
    sum += weight * diffSquared;
    wsum += weight;
  };

  // Sayısal alanlar (min-max normalize edilmiş fark).
  for (const field of NUMERIC_FIELDS) {
    const weight = field === "rr" ? w.rr : field === "eqRR" ? w.eqRR : w.score;
    const na = normalizeNumeric(numericValue(a, field), index.ranges[field]);
    const nb = normalizeNumeric(numericValue(b, field), index.ranges[field]);
    add(weight, (na - nb) ** 2);
  }

  // Grade ordinal (1..4 → 0..1).
  add(w.grade, ((gradeOrdinal(a.grade) - gradeOrdinal(b.grade)) / 3) ** 2);

  // Yön (-1/0/1 → 0..1).
  add(w.direction, (((directionSign(a.direction) - directionSign(b.direction)) / 2) ** 2));

  // HTF bias uyumu (yöne göreli, -1/0/1 → 0..1).
  add(w.dailyBias, (((biasSign(a.dailyBias) * directionSign(a.direction)) - (biasSign(b.dailyBias) * directionSign(b.direction))) / 2) ** 2);
  add(w.h4Bias, (((biasSign(a.h4Bias) * directionSign(a.direction)) - (biasSign(b.h4Bias) * directionSign(b.direction))) / 2) ** 2);
  add(w.h1Bias, (((biasSign(a.h1Bias) * directionSign(a.direction)) - (biasSign(b.h1Bias) * directionSign(b.direction))) / 2) ** 2);

  // Kategorik alanlar (eşit=0, değil=1).
  const cat = (x: string) => (x ?? "").toString().trim().toLowerCase();
  add(w.premiumDiscount, cat(a.premiumDiscount) === cat(b.premiumDiscount) ? 0 : 1);
  add(w.session, cat(a.session) === cat(b.session) ? 0 : 1);
  add(w.regime, cat(a.regime) === cat(b.regime) ? 0 : 1);

  return wsum > 0 ? Math.sqrt(sum / wsum) : 0;
}

export type SimilarNeighbor = {
  trade: RuntimeReplayTrade;
  distance: number;
  similarity: number; // 1 = birebir, 0'a doğru = uzak
};

export type SimilarOutcome = {
  neighbors: SimilarNeighbor[];
  // Sonuç istatistikleri — SADECE tetiklenip çözülmüş (tp1/tp2/stopped) komşulardan.
  resolved: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalR: number;
  avgR: number;
  medianR: number;
  expectancyR: number;
  // İnsan-okur tek satır.
  summary: string;
};

const RESOLVED_STATUSES = new Set(["tp1", "tp2", "stopped"]);

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Bir sorgu kuruluma en yakın k geçmiş kurulumu bul ve o komşuların gerçek R sonucunu özetle.
export function findSimilarSetups(
  index: SetupSimilarityIndex,
  corpus: RuntimeReplayTrade[],
  query: SetupLike,
  k = 10
): SimilarOutcome {
  const ranked = corpus
    .map((trade) => {
      const distance = setupDistance(query, trade, index);
      return { trade, distance, similarity: 1 / (1 + distance) };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(0, k));

  const resolved = ranked.filter((n) => RESOLVED_STATUSES.has(n.trade.status));
  const rs = resolved.map((n) => n.trade.rMultiple);
  const wins = rs.filter((r) => r > 0).length;
  const losses = rs.filter((r) => r < 0).length;
  const totalR = rs.reduce((sum, r) => sum + r, 0);
  const avgR = rs.length ? totalR / rs.length : 0;
  const winRatePct = rs.length ? (wins / rs.length) * 100 : 0;

  const summary = rs.length
    ? `${rs.length} benzer kurulum · ${winRatePct.toFixed(0)}% kazanç · ort ${avgR >= 0 ? "+" : ""}${avgR.toFixed(2)}R · toplam ${totalR >= 0 ? "+" : ""}${totalR.toFixed(1)}R`
    : "benzer çözülmüş kurulum yok (yetersiz geçmiş)";

  return {
    neighbors: ranked,
    resolved: rs.length,
    wins,
    losses,
    winRatePct,
    totalR,
    avgR,
    medianR: median(rs),
    expectancyR: avgR, // her işlem 1R risk → beklenti = ortalama R
    summary
  };
}

// Tek adımda: korpustan index kurup en yakın k komşuyu döndürür.
export function similarSetupOutcome(corpus: RuntimeReplayTrade[], query: SetupLike, k = 10): SimilarOutcome {
  return findSimilarSetups(buildSetupSimilarityIndex(corpus), corpus, query, k);
}
