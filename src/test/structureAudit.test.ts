import { describe, expect, it } from "vitest";
import { buildStructureAudit } from "../lib/signals/structureAudit";
import { createCrtSignal } from "./strategyFixtures";

describe("structure audit", () => {
  it("does not let UI or AI invent an FVG when the plan has no selected gap", async () => {
    const crt = await createCrtSignal();
    const signal = {
      ...crt,
      evidence: crt.evidence.filter((item) => item.id !== "fvg" && item.id !== "poi"),
      plan: { ...crt.plan, entryModel: { ...crt.plan.entryModel, fairValueGap: undefined, retested: false } }
    };

    const audit = buildStructureAudit(signal);
    const poi = audit.items.find((item) => item.label === "POI");

    expect(poi?.status).not.toBe("pass");
    expect(poi?.detail).toContain("POI teması yok");
    expect(poi?.detail).toContain("zone varmış gibi konuşma");
  });

  it("explains the exact candle close needed when MSS/CISD is missing", async () => {
    const crt = await createCrtSignal({ exitMinimumRR: 10 });
    // The same CRT before its ChoCH close: no confirmed shift, entry not confirmed.
    const signal = {
      ...crt,
      stage: "watch" as const,
      evidence: crt.evidence.map((item) => item.id === "choch" ? { ...item, status: "fail" as const } : item),
      plan: { ...crt.plan, entryStatus: "pending" as const, entryModel: { ...crt.plan.entryModel, cisdConfirmed: false } }
    };

    const audit = buildStructureAudit(signal);
    const mss = audit.items.find((item) => item.label === "Distribution");

    expect(mss?.status).toBe("wait");
    expect(mss?.detail).toContain("kapanışı bekleniyor");
  });

  it("marks invalidated ideas as blocked instead of trade candidates", async () => {
    const signal = await createCrtSignal();
    const invalidated = {
      ...signal,
      stage: "invalidated" as const,
      outcome: { ...signal.outcome, status: "stopped" as const }
    };

    const audit = buildStructureAudit(invalidated);

    expect(audit.verdict).toBe("blocked");
    expect(audit.headline).toContain("Bozuldu");
    expect(audit.decision).toContain("yeni setup bekle");
    expect(audit.items.find((item) => item.label === "Risk")?.status).toBe("fail");
  });
});
