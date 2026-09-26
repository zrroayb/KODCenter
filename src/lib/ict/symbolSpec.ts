import type { MarketSymbol } from "./types";

// Tek sembol tablosu: sembole özgü her sabit burada. Stop buffer, maliyet, sentetik spread,
// nokta değeri, korelasyon kümesi, SMT partnerleri ve Yahoo ticker'ı ayrı dosyalarda
// çoğaltılmaz; yeni sembol = buraya tek satır.
export type SymbolCluster = "dollar-fx" | "metal" | "index" | "crypto" | "other";

export type SymbolSpec = {
  name: string;
  yahoo: string;
  crypto: boolean;
  cluster: SymbolCluster;
  // Sembol yükselince dolar zayıflıyorsa true (EURUSD), tersiyse false (USDJPY).
  usdInverse: boolean;
  // Stop'un yapının ötesine en az ne kadar konacağı (fiyat birimi).
  minBuffer: number;
  // Tahmini işlem maliyeti (fiyat birimi). `spread` aynı zamanda sentetik bid/ask'i kurar.
  spread: number;
  slippage: number;
  commission: number;
  // 1 birimlik pozisyonun 1.0 fiyat hareketindeki USD karşılığı. Brokera göre değişir:
  // `pointValueApprox` true ise boyut "lot" değil yaklaşık "birim" olarak okunmalı.
  pointValue: number;
  pointValueApprox: boolean;
  smtPartners: MarketSymbol[];
};

export const SYMBOL_SPEC: Record<MarketSymbol, SymbolSpec> = {
  XAUUSD: {
    name: "Gold futures proxy · GC=F", yahoo: "GC=F", crypto: false, cluster: "metal", usdInverse: true,
    minBuffer: 0.8, spread: 0.35, slippage: 0.25, commission: 0.05,
    pointValue: 100, pointValueApprox: true, smtPartners: []
  },
  NAS100: {
    name: "Nasdaq futures proxy · NQ=F", yahoo: "NQ=F", crypto: false, cluster: "index", usdInverse: true,
    minBuffer: 12, spread: 4, slippage: 4, commission: 0,
    pointValue: 1, pointValueApprox: true, smtPartners: ["BTCUSD"]
  },
  EURUSD: {
    name: "Euro Dollar", yahoo: "EURUSD=X", crypto: false, cluster: "dollar-fx", usdInverse: true,
    minBuffer: 0.0002, spread: 0.00008, slippage: 0.00004, commission: 0.00002,
    pointValue: 100_000, pointValueApprox: false, smtPartners: ["GBPUSD", "AUDUSD"]
  },
  GBPUSD: {
    name: "Pound Dollar", yahoo: "GBPUSD=X", crypto: false, cluster: "dollar-fx", usdInverse: true,
    minBuffer: 0.0002, spread: 0.0001, slippage: 0.00005, commission: 0.00002,
    pointValue: 100_000, pointValueApprox: false, smtPartners: ["EURUSD", "AUDUSD"]
  },
  // Yahoo'nun USD-bazlı pariteler için ticker'ı USD önekini atar ("JPY=X" = USD/JPY).
  // USDJPY P&L'i JPY cinsinden: lot başına ~100k / kur (~145) USD — kura göre kayar.
  USDJPY: {
    name: "Dollar Yen", yahoo: "JPY=X", crypto: false, cluster: "dollar-fx", usdInverse: false,
    minBuffer: 0.03, spread: 0.012, slippage: 0.006, commission: 0.003,
    pointValue: 700, pointValueApprox: true, smtPartners: ["USDCHF"]
  },
  AUDUSD: {
    name: "Aussie Dollar", yahoo: "AUDUSD=X", crypto: false, cluster: "dollar-fx", usdInverse: true,
    minBuffer: 0.0002, spread: 0.0001, slippage: 0.00005, commission: 0.00002,
    pointValue: 100_000, pointValueApprox: false, smtPartners: ["EURUSD", "GBPUSD"]
  },
  USDCHF: {
    name: "Dollar Swiss", yahoo: "CHF=X", crypto: false, cluster: "dollar-fx", usdInverse: false,
    minBuffer: 0.0002, spread: 0.00012, slippage: 0.00006, commission: 0.00002,
    pointValue: 110_000, pointValueApprox: true, smtPartners: ["USDJPY"]
  },
  BTCUSD: {
    name: "Bitcoin", yahoo: "BTC-USD", crypto: true, cluster: "crypto", usdInverse: true,
    minBuffer: 120, spread: 35, slippage: 60, commission: 15,
    pointValue: 1, pointValueApprox: false, smtPartners: ["ETHUSD", "NAS100"]
  },
  ETHUSD: {
    name: "Ethereum", yahoo: "ETH-USD", crypto: true, cluster: "crypto", usdInverse: true,
    minBuffer: 6, spread: 2, slippage: 3.5, commission: 1,
    pointValue: 1, pointValueApprox: false, smtPartners: ["BTCUSD", "SOLUSD"]
  },
  XRPUSD: {
    name: "XRP", yahoo: "XRP-USD", crypto: true, cluster: "crypto", usdInverse: true,
    minBuffer: 0.005, spread: 0.002, slippage: 0.003, commission: 0.001,
    pointValue: 1, pointValueApprox: false, smtPartners: ["BTCUSD"]
  },
  BNBUSD: {
    name: "BNB", yahoo: "BNB-USD", crypto: true, cluster: "crypto", usdInverse: true,
    minBuffer: 1.5, spread: 0.5, slippage: 0.9, commission: 0.3,
    pointValue: 1, pointValueApprox: false, smtPartners: ["BTCUSD"]
  },
  SOLUSD: {
    name: "Solana", yahoo: "SOL-USD", crypto: true, cluster: "crypto", usdInverse: true,
    minBuffer: 0.4, spread: 0.09, slippage: 0.16, commission: 0.05,
    pointValue: 1, pointValueApprox: false, smtPartners: ["ETHUSD", "BTCUSD"]
  }
};

export const MARKET_SYMBOLS = Object.keys(SYMBOL_SPEC) as MarketSymbol[];

export function symbolSpec(symbol: string): SymbolSpec | undefined {
  return SYMBOL_SPEC[symbol as MarketSymbol];
}
