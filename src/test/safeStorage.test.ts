import { afterEach, describe, expect, it, vi } from "vitest";
import { safeSetJson } from "../lib/storage/safeStorage";

// A storage that throws QuotaExceededError once the serialized value is over `limit` chars.
function quotaStorage(limit: number) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (value.length > limit) throw new DOMException("quota", "QuotaExceededError");
      data.set(key, value);
    },
    removeItem: (key: string) => { data.delete(key); },
    key: () => null,
    clear: () => data.clear(),
    length: 0
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("safeSetJson (localStorage quota never crashes the app)", () => {
  it("trims a newest-first history until it fits instead of throwing", () => {
    const store = quotaStorage(200);
    vi.stubGlobal("window", { localStorage: store });
    const history = Array.from({ length: 50 }, (_, index) => ({ id: index, note: "setup" }));
    expect(() => safeSetJson("tradebot.crtSessionSetups.v1", history)).not.toThrow();
    const saved = JSON.parse(store.data.get("tradebot.crtSessionSetups.v1") ?? "[]") as Array<{ id: number }>;
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.length).toBeLessThan(50);
    expect(saved[0].id).toBe(0); // newest entries kept
  });

  it("drops a rebuildable key that cannot fit at all, without throwing", () => {
    const store = quotaStorage(5);
    vi.stubGlobal("window", { localStorage: store });
    store.data.set("k", "old");
    expect(safeSetJson("k", { big: "x".repeat(100) })).toBe(false);
    expect(store.data.has("k")).toBe(false);
  });

  it("never trims or drops user-owned data (preserve)", () => {
    const store = quotaStorage(5);
    vi.stubGlobal("window", { localStorage: store });
    store.data.set("tradebot.localJournal.v1", "[1]");
    expect(safeSetJson("tradebot.localJournal.v1", [1, 2, 3, 4, 5, 6, 7], { preserve: true })).toBe(false);
    expect(store.data.get("tradebot.localJournal.v1")).toBe("[1]");
  });
});
