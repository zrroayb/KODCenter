import { defaultRules } from "./defaultRules";
import type { UserRules } from "./userRules";

const STORAGE_KEY = "tradebot-user-rules-v1";

function storage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function loadUserRules(): UserRules {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return defaultRules;
    const parsed = JSON.parse(raw) as Partial<UserRules>;
    return {
      ...defaultRules,
      ...parsed,
      allowedSymbols: Array.isArray(parsed.allowedSymbols) && parsed.allowedSymbols.length
        ? parsed.allowedSymbols.filter((symbol) => defaultRules.allowedSymbols.includes(symbol))
        : defaultRules.allowedSymbols,
      allowedKillzones: Array.isArray(parsed.allowedKillzones) && parsed.allowedKillzones.length
        ? parsed.allowedKillzones.filter((zone) => defaultRules.allowedKillzones.includes(zone))
        : defaultRules.allowedKillzones
    };
  } catch {
    return defaultRules;
  }
}

export function saveUserRules(rules: UserRules) {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // A private/blocked storage context should not stop scanning.
  }
}
