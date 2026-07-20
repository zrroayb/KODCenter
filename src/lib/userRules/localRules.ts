import { defaultRules } from "./defaultRules";
import { resolveStoredRules } from "./resolveRules";
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
    return resolveStoredRules(JSON.parse(raw));
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
