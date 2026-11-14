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

