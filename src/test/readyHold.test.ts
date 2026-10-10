import { describe, expect, it } from "vitest";
import { mergeReadyHoldSignals, readyHoldSignature } from "../lib/signals/readyHold";
import { createCrtSignal } from "./strategyFixtures";

describe("ready signal hold", () => {
  it("keeps a previously READY setup ready when the next scan downgrades the same setup to WATCH", async () => {
    // Same CRT setup; the second scan's exit-RR floor (10) is above its DOL RR -> WATCH (RR is not
    // a structural blocker, so the hold applies).
    const ready = await createCrtSignal();
    const watch = await createCrtSignal({ exitMinimumRR: 10 });

    const first = mergeReadyHoldSignals([ready], {}, 1_000);
    const second = mergeReadyHoldSignals([watch], first.records, 2_000);

    expect(ready.stage).toBe("ready");
    expect(watch.stage).toBe("watch");
    expect(readyHoldSignature(watch)).toBe(readyHoldSignature(ready));
    expect(second.signals[0].stage).toBe("ready");
    expect(second.signals[0].id).toBe(ready.id);
    expect(second.signals[0].riskWarnings.join(" ")).toContain("READY sinyal kilidi");
    // UI "kilitli" rozeti bu işarete bakar; motorun kendi READY'sinde işaret yok.
    expect(second.signals[0].readyHoldExpiresAt).toBe(first.records[readyHoldSignature(ready)].expiresAt);
    expect(first.signals[0].readyHoldExpiresAt).toBeUndefined();
  });

  it("clears the hold when the same setup becomes invalidated", async () => {
    const ready = await createCrtSignal();
    const invalidated = { ...ready, stage: "invalidated" as const };

    const first = mergeReadyHoldSignals([ready], {}, 1_000);
    const second = mergeReadyHoldSignals([invalidated], first.records, 2_000);

    expect(second.signals[0].stage).toBe("invalidated");
    expect(Object.keys(second.records)).toHaveLength(0);
  });

  it("uses the CRT range and raid as the stable identity when confirmation details refresh", async () => {
    const crtReady = await createCrtSignal();
    const refreshed = {
      ...crtReady,
      id: `${crtReady.id}-refresh`,
      evidence: [
        ...crtReady.evidence.filter((item) => item.id !== "choch"),
        { id: "choch", label: "ChoCH", detail: "Internal low altında kapandı", status: "pass" as const, time: 20_000, price: 99.4 }
      ],
      plan: { ...crtReady.plan, entry: crtReady.plan.entry + 0.1 }
    };

    expect(readyHoldSignature(refreshed)).toBe(readyHoldSignature(crtReady));
  });
});

describe("ready hold lets go when the engine names a real reason", () => {
  it("releases immediately on a structural blocker (e.g. HTF turned opposite)", async () => {
    const { holdMustRelease } = await import("../lib/signals/readyHold");
    const base = { governance: { blockers: [] as string[] } } as unknown as Parameters<typeof holdMustRelease>[0];
    expect(holdMustRelease(base)).toBe(false);
    expect(holdMustRelease({ ...base, governance: { ...base.governance, blockers: ["HTF yönü ters: 1d bearish — trend tersine CRT işlenmez."] } })).toBe(true);
    expect(holdMustRelease({ ...base, governance: { ...base.governance, blockers: ["DOL/TP çıkış net RR yetersiz (0.8 < 1)."] } })).toBe(false);
  });
});
