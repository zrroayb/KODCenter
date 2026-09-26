import type { MarketSymbol } from "./types";
import { SYMBOL_SPEC, symbolSpec, type SymbolCluster } from "./symbolSpec";

export type { SymbolCluster } from "./symbolSpec";

export function isCryptoSymbol(symbol: MarketSymbol): boolean {
  return symbolSpec(symbol)?.crypto ?? false;
}

// Korelasyon kümeleri: aynı kümedeki semboller aynı makro bahsi paylaşır. Hem replay'in
// küme-günü ölçümü hem de bias tablosunun sıralaması buradan beslenir. Kaynak: SYMBOL_SPEC.
export const SYMBOL_CLUSTERS: Record<string, { cluster: SymbolCluster; usdInverse: boolean }> = Object.fromEntries(
  Object.entries(SYMBOL_SPEC).map(([symbol, spec]) => [symbol, { cluster: spec.cluster, usdInverse: spec.usdInverse }])
);

export const CLUSTER_ORDER: SymbolCluster[] = ["dollar-fx", "metal", "index", "crypto", "other"];

export const CLUSTER_LABEL: Record<SymbolCluster, string> = {
  "dollar-fx": "Dolar / FX",
  metal: "Metal",
  index: "Endeks",
  crypto: "Kripto",
  other: "Diğer"
};

export function clusterOf(symbol: string): SymbolCluster {
  return SYMBOL_CLUSTERS[symbol]?.cluster ?? "other";
}

// Sembolün yönünü dolar cinsine çevirir: EURUSD short ≈ USDJPY long ≈ "usd-long".
// Kripto kendi betasına normalize edilir.
export function clusterExposure(symbol: string, direction: "long" | "short"): { cluster: SymbolCluster; exposure: string } {
  const spec = SYMBOL_CLUSTERS[symbol] ?? { cluster: "other" as SymbolCluster, usdInverse: true };
  if (spec.cluster === "crypto") {
    return { cluster: spec.cluster, exposure: direction === "long" ? "crypto-long" : "crypto-short" };
  }
  const usdLong = spec.usdInverse ? direction === "short" : direction === "long";
  return { cluster: spec.cluster, exposure: usdLong ? "usd-long" : "usd-short" };
}
