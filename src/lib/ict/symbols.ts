import type { MarketSymbol } from "./types";

const CRYPTO_SYMBOLS: ReadonlySet<MarketSymbol> = new Set(["BTCUSD", "ETHUSD", "XRPUSD", "BNBUSD", "SOLUSD"]);

export function isCryptoSymbol(symbol: MarketSymbol): boolean {
  return CRYPTO_SYMBOLS.has(symbol);
}

// Korelasyon kümeleri: aynı kümedeki semboller aynı makro bahsi paylaşır. Hem replay'in
// küme-günü ölçümü hem de bias tablosunun sıralaması buradan beslenir — tek kaynak.
// `usdInverse`: sembol yükselince dolar zayıflıyorsa true (EURUSD), tersiyse false (USDJPY).
export type SymbolCluster = "dollar-fx" | "metal" | "index" | "crypto" | "other";

export const SYMBOL_CLUSTERS: Record<string, { cluster: SymbolCluster; usdInverse: boolean }> = {
  EURUSD: { cluster: "dollar-fx", usdInverse: true },
  GBPUSD: { cluster: "dollar-fx", usdInverse: true },
  AUDUSD: { cluster: "dollar-fx", usdInverse: true },
  USDJPY: { cluster: "dollar-fx", usdInverse: false },
  USDCHF: { cluster: "dollar-fx", usdInverse: false },
  XAUUSD: { cluster: "metal", usdInverse: true },
  NAS100: { cluster: "index", usdInverse: true },
  BTCUSD: { cluster: "crypto", usdInverse: true },
  ETHUSD: { cluster: "crypto", usdInverse: true },
  XRPUSD: { cluster: "crypto", usdInverse: true },
  BNBUSD: { cluster: "crypto", usdInverse: true },
  SOLUSD: { cluster: "crypto", usdInverse: true }
};

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
