import { defaultRules } from "./defaultRules";
import { effectiveMinimumScore } from "./scorePolicy";
import type { UserRules } from "./userRules";

// Tek kural çözücüsü: localStorage (site) ve D1 (bulut botu) aynı ham JSON'u buradan geçirir.
// Bilinmeyen alanlar düşer, sembol/killzone listeleri whitelist'e süzülür, skor tabanı uygulanır —
// iki taraf farklı sanitize ederse Telegram/site paritesi yine kayar.
export function resolveStoredRules(raw: unknown): UserRules {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaultRules;
  const parsed = raw as Partial<UserRules>;
  const allowedSymbols = Array.isArray(parsed.allowedSymbols)
    ? parsed.allowedSymbols.filter((symbol) => defaultRules.allowedSymbols.includes(symbol))
    : [];
  const allowedKillzones = Array.isArray(parsed.allowedKillzones)
    ? parsed.allowedKillzones.filter((zone) => defaultRules.allowedKillzones.includes(zone))
    : [];
  const merged: UserRules = {
    ...defaultRules,
    ...parsed,
    allowedSymbols: allowedSymbols.length ? allowedSymbols : defaultRules.allowedSymbols,
    allowedKillzones: allowedKillzones.length ? allowedKillzones : defaultRules.allowedKillzones
  };
  return { ...merged, minimumScore: effectiveMinimumScore(merged.minimumScore) };
}
