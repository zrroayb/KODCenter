// Trade yorumu kontratı (Gemini + lokal fallback ortak). Gemini metni motorun stage'i ve çıkış
// modeliyle çelişirse gösterilmez; lokal fallback döner. vite.config.ts (canlı) ve
// tradeCommentary.ts (istemci) aynı kuralı buradan okur.

// Çıkış modeli: pozisyonun tamamı DOL'da (karşı likidite) kapanır; fiyat EQ'ya gelince stop
// break-even'a çekilir. Pozisyon bölünmez (kısmi TP yok).
export const EXIT_MODEL_RULE = "Çıkış modeli: pozisyonun tamamı DOL'da (karşı likidite) kapanır; fiyat EQ'ya gelince stop break-even'a çekilir. Kısmi TP yok.";

export function dolBeManagementLine(entry: string, eq: string, dol: string): string {
  return `Beklenen: Entry ${entry}; EQ ${eq} görülünce stop BE'ye, pozisyonun tamamı DOL ${dol} seviyesinde kapanır.`;
}

const REQUIRED_KARAR: Record<string, string> = {
  ready: "Plan hazır",
  watch: "Bekle",
  // Filled trade still running after its entry window (engine stage "missed", outcome "open").
  "open-trade": "İşlem açık"
};

// The stage the commentary contract uses: an open trade is never "missed" for whoever holds it.
export function commentaryStage(stage: string, outcomeStatus: string | undefined): string {
  return stage === "missed" && outcomeStatus === "open" ? "open-trade" : stage;
}

// Kısmi TP / "kalanı DOL'a" dili tek-çıkış modeline ters: pozisyon EQ'da bölünmez, yalnız stop BE'ye gelir.
const PARTIAL_EXIT_PATTERN = /kısmi\s+(al|kar|kâr|tp|çık)|kalan(ı|ını)\s+dol/i;

function kararText(commentary: string): string | undefined {
  const line = commentary.split("\n").map((item) => item.trim()).find((item) => /^karar\s*:/i.test(item));
  return line?.replace(/^karar\s*:\s*/i, "");
}

// Geçersizse nedenini döner, geçerliyse undefined.
export function tradeCommentaryViolation(commentary: string, stage: string | undefined): string | undefined {
  const karar = kararText(commentary);
  if (!karar) return "Yorumda Karar satırı yok.";
  const required = stage ? REQUIRED_KARAR[stage] : undefined;
  if (required && !karar.toLocaleLowerCase("tr").startsWith(required.toLocaleLowerCase("tr"))) {
    return `Stage=${stage} için Karar "${required}" ile başlamalı.`;
  }
  if (PARTIAL_EXIT_PATTERN.test(commentary)) return "Yorum kısmi TP diyor; çıkış tek: tamamı DOL'da, EQ'da yalnız stop BE'ye gelir.";
  return undefined;
}

export const TRADE_COMMENTARY_STAGE_RULE =
  `Stage=ready ise Karar satırı "Plan hazır" ile başlar; Stage=watch ise "Bekle" ile başlar; Stage=open-trade (entry dolmuş, işlem açık, yeni giriş yok) ise "İşlem açık" ile başlar ve pozisyon yönetimini anlatır — "kaçtı/kovalama" deme. ${EXIT_MODEL_RULE}`;
