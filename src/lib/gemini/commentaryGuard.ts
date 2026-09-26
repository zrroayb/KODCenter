// Trade yorumu kontratı (Gemini + lokal fallback ortak). Gemini metni motorun stage'i ve çıkış
// modeliyle çelişirse gösterilmez; lokal fallback döner. vite.config.ts (canlı) ve
// tradeCommentary.ts (istemci) aynı kuralı buradan okur.

// Çıkış modeli eq-full: pozisyonun tamamı EQ'da kapanır, DOL yalnız uzatma bilgisi.
export const EQ_FULL_EXIT_RULE = "Çıkış modeli: pozisyonun tamamı EQ'da kapanır; kısmi TP yok, DOL yalnız uzatma bilgisi.";

export function eqFullManagementLine(entry: string, eq: string): string {
  return `Beklenen: Entry ${entry}; pozisyonun tamamı EQ ${eq} seviyesinde kapanır, DOL yalnız bilgi.`;
}

const REQUIRED_KARAR: Record<string, string> = {
  ready: "Plan hazır",
  watch: "Bekle"
};

// Kısmi TP / "kalanı DOL'a" dili eq-full modeline ters.
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
  if (PARTIAL_EXIT_PATTERN.test(commentary)) return "Yorum kısmi TP diyor; çıkış modeli tam EQ.";
  return undefined;
}

export const TRADE_COMMENTARY_STAGE_RULE =
  `Stage=ready ise Karar satırı "Plan hazır" ile başlar; Stage=watch ise "Bekle" ile başlar. ${EQ_FULL_EXIT_RULE}`;
