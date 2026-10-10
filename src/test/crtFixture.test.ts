import { describe, expect, it } from "vitest";
import { createCrtSignal } from "./strategyFixtures";

describe("CRT pipeline fixture (real engine, replaces the legacy KOD model)", () => {
  it("is a confirmed 4H short: READY at the default exit RR, WATCH above its DOL RR", async () => {
    const ready = await createCrtSignal();
    expect(ready.stage).toBe("ready");
    expect(ready.plan.entryStatus).toBe("confirmed");
    expect(ready.governance.blockers).toEqual([]);
    const watch = await createCrtSignal({ exitMinimumRR: 10 });
    expect(watch.stage).toBe("watch");
    expect(watch.governance.blockers.join(" ")).toContain("RR yetersiz");
  });
});
