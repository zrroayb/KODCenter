import type { TradingSignal } from "../src/lib/ict/types";

// Huni kapıları (scripts/crt-funnel.ts): sinyalin kendi alanlarından ve blocker metinlerinden
// okunur — motor değişmez. Ayrı dosya: testler node tiplerine dokunmadan sınıflandırmayı sınar.
export const GATES = ["raid", "c2Closed", "reclaim", "choch", "poi", "entry", "keyLevel", "htf", "pd", "rr", "other", "ready"] as const;
export type Gate = typeof GATES[number];
export const GATE_LABEL: Record<Gate, string> = {
  raid: "HTF raid var (yön raid'den)",
  c2Closed: "C2 range içinde kapandı",
  reclaim: "reclaim (onay TF kapanışı içeride)",
  choch: "ChoCH / shift onayı",
  poi: "POI (FVG/OB) bulundu",
  entry: "C3'te retest (entry confirmed)",
  keyLevel: "key level",
  htf: "D/W/M yön",
  pd: "CRT range PD",
  rr: "DOL net RR",
  other: "diğer blocker yok (EQ tüketildi, C3 bitti, kovalanmaz, veri)",
  ready: "READY"
};

const has = (signal: TradingSignal, pattern: RegExp) => signal.governance.blockers.some((item) => pattern.test(item));
const KNOWN_BLOCKERS = [/Manipulation yok/, /reclaim yok/, /raid yok; yön yalnızca/, /Candle 2/, /ChoCH|kapanışı bu|shift mum/, /HTF yönü/, /Key level yok/, /P\/D yanlış/, /RR yetersiz/];

export function gateFlags(signal: TradingSignal): Record<Gate, boolean> {
  const evidence = (id: string) => signal.evidence.find((item) => item.id === id)?.status;
  return {
    raid: Boolean(signal.crtAnchor?.raidActive),
    c2Closed: Boolean(signal.crtAnchor?.raidClosed),
    reclaim: !has(signal, /reclaim yok/),
    choch: evidence("choch") === "pass",
    poi: evidence("poi") === "pass",
    entry: signal.plan.entryStatus === "confirmed",
    keyLevel: !has(signal, /Key level yok/),
    htf: !has(signal, /HTF yönü/),
    pd: !has(signal, /P\/D yanlış/),
    rr: !has(signal, /RR yetersiz/),
    other: !signal.governance.blockers.some((item) => !KNOWN_BLOCKERS.some((pattern) => pattern.test(item))),
    ready: signal.stage === "ready"
  };
}

// POI is informative, not a gate; the funnel skips it when computing depth.
export const DEPTH_GATES = GATES.filter((gate) => gate !== "poi");
export function depth(flags: Record<Gate, boolean>): number {
  let reached = 0;
  for (const gate of DEPTH_GATES) {
    if (!flags[gate]) break;
    reached += 1;
  }
  return reached;
}


// Why a setup with a raid did not get its ChoCH. Read from the signal itself (evidence: the
// reference swing and the manipulation candle) and its own confirm-TF candles. It mirrors the
// engine's ChoCH rules (detectCrtChoch) APPROXIMATELY — the close-through floor uses only the
// average-range part — so it is a diagnosis for the report, never a gate.
export type ChochFailure = "no-reference" | "not-broken" | "outside-window" | "weak-break" | "stale-break" | "other";
export const CHOCH_FAILURE_LABEL: Record<ChochFailure, string> = {
  "no-reference": "referans yok (sweep öncesi iç swing bulunamadı)",
  "not-broken": "referans var, kapanışla kırılmadı",
  "outside-window": "kırıldı ama sweep'ten 12 mumdan sonra",
  "weak-break": "kırıldı ama zayıf (gövde < 0.5 veya range < 0.8 × ortalama, bağlı FVG yok)",
  "stale-break": "kırıldı ama son 16 mumdan eski",
  other: "sınıflanamadı"
};

const CHOCH_MAX_DELAY = 12;
const CHOCH_FRESHNESS = 16;

function confirmCandles(signal: TradingSignal) {
  const tf = signal.crtAnchor?.confirmTf;
  const frames = signal.context.timeframes;
  const candles = tf === "15m" ? (frames.m15.length ? frames.m15 : frames.m5)
    : tf === "1h" ? frames.h1
      : tf === "1d" ? frames.daily
        : frames.h4;
  return candles.filter((candle) => candle.closed !== false);
}

export function chochFailureReason(signal: TradingSignal): ChochFailure {
  const choch = signal.evidence.find((item) => item.id === "choch");
  const manipulation = signal.evidence.find((item) => item.id === "manipulation");
  if (typeof choch?.price !== "number" || typeof choch.candleIndex !== "number") return "no-reference";
  const manipulationIndex = manipulation?.candleIndex;
  if (typeof manipulationIndex !== "number") return "other";
  const candles = confirmCandles(signal);
  const level = choch.price;
  const short = signal.direction === "short";
  const ranges = candles.slice(-20).map((candle) => candle.high - candle.low);
  const averageRange = ranges.reduce((sum, value) => sum + value, 0) / Math.max(ranges.length, 1);
  const minimumCloseThrough = averageRange * 0.03;
  const from = Math.max(manipulationIndex + 1, choch.candleIndex + 2);
  const breaks: number[] = [];
  for (let index = from; index < candles.length; index += 1) {
    const candle = candles[index];
    const directional = short ? candle.close < candle.open : candle.close > candle.open;
    const through = short ? level - candle.close : candle.close - level;
    if (directional && through >= minimumCloseThrough) breaks.push(index);
  }
  if (!breaks.length) return "not-broken";
  const first = breaks[0];
  if (first > manipulationIndex + CHOCH_MAX_DELAY) return "outside-window";
  if (first < candles.length - CHOCH_FRESHNESS) return "stale-break";
  const candle = candles[first];
  const range = Math.max(candle.high - candle.low, 0.000001);
  const strong = Math.abs(candle.close - candle.open) / range >= 0.5 && range / Math.max(averageRange, 0.000001) >= 0.8;
  return strong ? "other" : "weak-break";
}
