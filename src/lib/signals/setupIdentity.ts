import type { TradingSignal } from "../ict/types";

function priceBucket(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "na";
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(5);
}

function evidenceAnchor(signal: TradingSignal, ids: string[]): string {
  const evidence = ids
    .map((id) => signal.evidence.find((item) => item.id === id))
    .find(Boolean);
  if (!evidence) return "na";
  return `${evidence.time ?? evidence.candleIndex ?? "na"}:${priceBucket(evidence.price)}`;
}

export function signalSetupIdentity(signal: TradingSignal): string {
  const anchor = signal.crtAnchor;
  if (anchor) {
    return [
      signal.strategyId,
      signal.symbol,
      signal.direction,
      anchor.rangeTf,
      anchor.origin ?? "standard",
      priceBucket(anchor.rangeHigh),
      priceBucket(anchor.rangeLow),
      evidenceAnchor(signal, ["manipulation", "sweep"])
    ].join("|");
  }

  return [
    signal.strategyId,
    signal.symbol,
    signal.direction,
    evidenceAnchor(signal, ["sweep"]),
    evidenceAnchor(signal, ["mss", "choch"]),
    evidenceAnchor(signal, ["fvg", "entry"])
  ].join("|");
}
