import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAlertStore, isAuthorizedScan } from "../../server/alertGate";

describe("server-side Telegram alert gate", () => {
  it("fails closed: no token configured or wrong bearer is never authorized", () => {
    expect(isAuthorizedScan("Bearer x", undefined)).toBe(false);
    expect(isAuthorizedScan(undefined, "secret")).toBe(false);
    expect(isAuthorizedScan("Bearer wrong!", "secret")).toBe(false);
    expect(isAuthorizedScan("Bearer secret", "secret")).toBe(true);
  });

  it("dedupes across callers and survives a restart of the same instance", () => {
    const path = join(mkdtempSync(join(tmpdir(), "alert-gate-")), "log.json");
    const store = createAlertStore(path);
    expect(store.claim("k1", 1_000)).toBe(true);
    // A second device / second scan in flight cannot double-send.
    expect(store.claim("k1", 1_500)).toBe(false);
    store.markSent("k1", { dedupeKey: "k1", signalId: "s", symbol: "EURUSD", sentAt: 2_000 }, 2_000);
    expect(store.claim("k1", 3_000)).toBe(false);

    const reopened = createAlertStore(path);
    expect(reopened.claim("k1", 4_000)).toBe(false);
    expect(reopened.recent(5_000)).toHaveLength(1);
  });

  it("a failed send releases the claim so the next scan retries", () => {
    const path = join(mkdtempSync(join(tmpdir(), "alert-gate-")), "log.json");
    const store = createAlertStore(path);
    expect(store.claim("k2")).toBe(true);
    store.release("k2");
    expect(store.claim("k2")).toBe(true);
  });
});
