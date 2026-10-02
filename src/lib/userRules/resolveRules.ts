import { defaultRules } from "./defaultRules";
import { effectiveMinimumScore } from "./scorePolicy";
import type { UserRules } from "./userRules";

// Tek kural çözücüsü: localStorage (site) ham JSON'u buradan geçirir.
//
// Kullanıcı yalnız 4 şeyi ayarlar (hesap büyüklüğü, işlem başı risk %, günlük max kayıp %,
// semboller). Geri kalan her kural sabit varsayılandır: eskiden kaydedilmiş, artık ekranda
// olmayan bir değer (kapatılmış bir filtre vb.) görünmez şekilde etkili kalmasın diye kayıttan
// OKUNMAZ (2026-10-02 sadeleştirme).
export const EDITABLE_RULE_KEYS = ["accountSize", "riskPerTradePct", "maxDailyRiskPct", "allowedSymbols"] as const;

function positiveNumber(value: unknown, fallback: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, max) : fallback;
}

export function resolveStoredRules(raw: unknown): UserRules {
  const base: UserRules = { ...defaultRules, minimumScore: effectiveMinimumScore(defaultRules.minimumScore) };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const parsed = raw as Partial<UserRules>;
  const allowedSymbols = Array.isArray(parsed.allowedSymbols)
    ? parsed.allowedSymbols.filter((symbol) => defaultRules.allowedSymbols.includes(symbol))
    : [];
  return {
    ...base,
    accountSize: positiveNumber(parsed.accountSize, defaultRules.accountSize, 1e9),
    riskPerTradePct: positiveNumber(parsed.riskPerTradePct, defaultRules.riskPerTradePct, 10),
    maxDailyRiskPct: positiveNumber(parsed.maxDailyRiskPct, defaultRules.maxDailyRiskPct, 50),
    allowedSymbols: allowedSymbols.length ? allowedSymbols : defaultRules.allowedSymbols
  };
}
