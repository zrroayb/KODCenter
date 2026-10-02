// localStorage writes must never crash the app. A full quota (~5MB, real market data grows the
// session/Silver Bullet histories fast) used to throw QuotaExceededError inside a React effect,
// which unmounted the whole tree — a blank screen right after data loaded.
//
// safeSetJson: try to write; on any error (quota, private mode) trim an array value by half and
// retry, and as a last resort drop the key so the rest of the storage keeps working. Never throws.

function storage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

// `preserve: true` is for user-owned data (journal, rules): never trim or drop it — if it can't be
// written, keep the previous stored copy and just report failure.
export function safeSetJson(key: string, value: unknown, options: { preserve?: boolean } = {}): boolean {
  const store = storage();
  if (!store) return false;
  if (options.preserve) {
    try {
      store.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
  let current = value;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      store.setItem(key, JSON.stringify(current));
      return true;
    } catch {
      // Arrays are newest-first histories: keep the newest half and retry.
      if (Array.isArray(current) && current.length > 1) {
        current = current.slice(0, Math.floor(current.length / 2));
        continue;
      }
      break;
    }
  }
  try {
    store.removeItem(key);
  } catch {
    // Nothing else to do; the in-memory state stays valid.
  }
  return false;
}
