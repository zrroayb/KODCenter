import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SilverBulletSection } from "../components/SilverBulletSection";
import type { SilverBulletSetup } from "../lib/strategies/silverBullet/types";

const fixture = {
  setupId: "NAS100:sb-ui",
  symbol: "NAS100",
  direction: "short",
  lifecycleStatus: "WAITING_FOR_STRUCTURE_SHIFT",
  score: 76,
  grade: "B",
  updatedAtUtc: Date.UTC(2026, 6, 20, 14, 30),
  windowStartUtc: Date.UTC(2026, 6, 20, 14),
  windowEndUtc: Date.UTC(2026, 6, 20, 15),
  referenceRange: {
    high: 22100,
    low: 21900,
    midpoint: 22000,
    close: 22020,
    rangeSize: 200
  },
  events: [{ id: "shift", status: "pending", label: "MSS", detail: "5m close pending" }],
  noTradeReasons: [],
  invalidationReasons: [],
  warnings: [],
  summary: "MSS pending"
} as unknown as SilverBulletSetup;

describe("Silver Bullet UI", () => {
  it("shows a single plain-language decision and hides evidence in technical details", () => {
    const html = renderToStaticMarkup(<SilverBulletSection logs={[]} setups={[fixture]} />);
    expect(html).toContain("Silver Bullet");
    expect(html).toContain("Aktif (1)");
    expect(html).toContain("Tek beklenen");
    expect(html).toContain("5m mum yön değişimini kapanışla onaylasın");
    expect(html).toContain("Plan haritası");
    expect(html).toContain("Teknik detay");
    expect(html).not.toContain("NY_AM_09_HOURLY_RANGE_REVERSAL_V1");
  });
});
