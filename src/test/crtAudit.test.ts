import { describe, expect, it } from "vitest";
import { __runtimeReplayInternals } from "../lib/backtest/runtimeReplay";
import { activeCrtRange } from "../lib/charts/crtRange";
import type { Candle, TradingSignal } from "../lib/ict/types";
import { crtStrategy, detectAnchorRaid, evaluateCrtHtfAlignment, scoreCrtSetup } from "../lib/strategies/crt/crt.strategy";
import { readHtfCrt } from "../lib/strategies/crt/htfCrt";
import { auditShortScenario, type AuditScenarioOptions } from "./crtAuditScenario";
import { createCrtSignal, createStructureContext, withHtfCrts } from "./strategyFixtures";
import { chochFailureReason, DEPTH_GATES, depth, gateFlags } from "../../scripts/crtFunnelGates";

// CRT DENETİMİ 2026-11 (docs/CRT_DENETIM_2026-11.md). Bu testler motorun BUGÜNKÜ davranışını
// sabitler. Her test bir şüphenin karşı-örneğidir. "DÜZELTİLDİ" yazanlar düzeltmeden sonra
// ters çevrildi (B1 replay, B2 dolum, B3/B4 True MSS); "DOĞRULANDI" yazanlar henüz açık.

const H4 = 4 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 5, 1, 21);
const k = (index: number, open: number, high: number, low: number, close: number, closed = true): Candle =>
  ({ time: T0 + index * H4, open, high, low, close, volume: 1, closed });
const SPEC_4H = { rangeTf: "4h", confirmTf: "15m" } as const;

function scanShort(options: AuditScenarioOptions = {}) {
  const scenario = auditShortScenario(options);
  const signal = crtStrategy.scan({ context: scenario.context, settings: { ...crtStrategy.defaultSettings, useExecutionCosts: false } })
    .signals.find((item) => item.crtAnchor?.rangeTf === "4h" && item.direction === "short") as TradingSignal;
  return { ...scenario, signal };
}

describe("CRT denetimi — şüphe 1 (B6): CRT tanımları", () => {
  it("DÜZELTİLDİ (kısmen): grafik ve D/W/M okuması tek fonksiyon (readCrtCycle) — aynı C1'i verir", () => {
    const candles = [
      k(0, 98, 99, 97, 98),
      k(1, 96, 101, 95, 100),
      k(2, 99, 100, 97, 98.5), // iç mum
      k(3, 98.5, 101.6, 98, 99), // ikisini de süpürüp içeride kapanan mum
      k(4, 99, 99.2, 98.8, 99, false)
    ];
    const htf = readHtfCrt(candles, "1d");
    const chart = activeCrtRange(candles);
    expect(htf.direction).toBe("short");
    expect(chart?.phase).toBe("c3");
    expect(chart?.high).toBe(htf.c1?.high);
    expect(chart?.low).toBe(htf.c1?.low);
  });

  it("DOĞRULANDI (açık, sahibinin kararı): motor C1'i 6 mum geriye arar; iç mum varken grafikten farklı C1 seçebilir", () => {
    const candles = [
      k(0, 98, 99, 97, 98),
      k(1, 96, 101, 95, 100), // motorun C1'i
      k(2, 99, 100, 97, 98.5),
      k(3, 98.5, 101.6, 98, 99),
      k(4, 99, 99.2, 98.8, 99, false)
    ];
    const engine = detectAnchorRaid(candles, SPEC_4H);
    expect(engine.raid?.direction).toBe("short");
    expect(engine.range.high).toBe(101);
    expect(activeCrtRange(candles)?.high).toBe(100);
  });
});

describe("CRT denetimi — şüphe 2: C2 dışarıda kapanırsa", () => {
  it("DÜZELTİLDİ (B8): C2 range dışında kapanınca sonraki mum içeri dönse de o C1'den raid yok (acceptance)", () => {
    const candles = [
      k(0, 98, 99, 97, 98),
      k(1, 96, 101, 95, 100), // C1
      k(2, 100, 102, 99.8, 101.8), // C2: range ÜSTÜNDE kapandı = acceptance
      k(3, 101.8, 101.9, 98.5, 99), // sonraki mum içeri döndü
      k(4, 99, 99.2, 98.8, 99, false)
    ];
    const read = detectAnchorRaid(candles, SPEC_4H);
    // Kaynak: dışarıda kapanış = CRT geçersiz. Artık C1 (101/95) için raid yok.
    expect(read.raid?.direction === "short" && read.range.high === 101).toBeFalsy();
  });
});

describe("CRT denetimi — şüphe 3/4: ChoCH = True MSS (düzeltildi)", () => {
  it("DÜZELTİLDİ: onay sweep ÖNCESİ swing low'un (99.3) kırılmasıdır", () => {
    const { signal } = scanShort();
    expect(signal.stage).toBe("ready");
    const choch = signal.evidence.find((item) => item.id === "choch");
    expect(choch?.price).toBeCloseTo(0.993, 6);
  });

  it("DÜZELTİLDİ: yalnız sweep sonrası mikro pivotu (100.3) kıran displacement artık onay değil", () => {
    const { signal } = scanShort({ breakSwing: false });
    expect(signal.stage).not.toBe("ready");
    expect(signal.evidence.find((item) => item.id === "choch")?.status).toBe("fail");
    expect(signal.governance.blockers.join(" ")).toContain("0.99300");
  });

  it("DÜZELTİLDİ: referans sabit — işlem sürerken yeni mikro pivotlar girişi kaydırmaz", () => {
    const grind: Array<[number, number, number, number]> = [
      [99.8, 99.85, 99.3, 99.4], [99.4, 99.6, 99.35, 99.5], [99.5, 99.55, 99.0, 99.1]
    ];
    const entries = [0, 1, 2, 3].map((n) => scanShort({ retestHigh: 100.0, after: grind.slice(0, n) }).signal);
    for (const signal of entries.slice(1)) {
      expect(signal.plan.entry).toBeCloseTo(entries[1].plan.entry, 9);
      expect(signal.plan.entryStatus).toBe("confirmed");
      expect(signal.stage).toBe("ready");
      expect(signal.outcome.status).toBe("open");
    }
  });
});

describe("CRT denetimi — şüphe 5 (B5): sıra", () => {
  it("DOĞRULANDI (açık): ChoCH Candle 2'nin İÇİNDE oluşmuşken READY", () => {
    const { signal, c3Open } = scanShort();
    expect(signal.stage).toBe("ready");
    expect(signal.evidence.find((item) => item.id === "choch")?.time).toBeLessThan(c3Open);
  });

  it("karşılaştırma: ChoCH C3 içinde olunca da READY (motor iki sırayı ayırmıyor)", () => {
    const { signal, c3Open } = scanShort({ chochInC3: true });
    expect(signal.stage).toBe("ready");
    expect(signal.evidence.find((item) => item.id === "choch")?.time).toBeGreaterThanOrEqual(c3Open);
  });
});

describe("CRT denetimi — şüphe 5 (B2): giriş / dolum (düzeltildi)", () => {
  it("DÜZELTİLDİ: FVG bölgesine dokunuş yetmez; dolum için fiyat GİRİŞ seviyesine (MSS 99.3) ulaşmalı", () => {
    // FVG 99.2-100.45, near edge below the MSS level → entry = 99.3. A retest high of 99.25
    // touches the zone but never the entry.
    const touchOnly = scanShort({ fvgLow: 99.2, retestHigh: 99.25, retestClose: 99.0 }).signal;
    expect(touchOnly.plan.entry).toBeCloseTo(0.993, 6);
    expect(touchOnly.plan.entryStatus).toBe("pending");
    expect(touchOnly.stage).not.toBe("ready");
    const reached = scanShort({ fvgLow: 99.2, retestHigh: 99.35, retestClose: 99.0 }).signal;
    expect(reached.plan.entryStatus).toBe("confirmed");
    expect(reached.stage).toBe("ready");
  });

  it("READY'nin girişi gerçekten işlem görmüştür (canlı sonuç motoru dolumu görür)", () => {
    const { signal } = scanShort();
    expect(signal.stage).toBe("ready");
    expect(signal.outcome.status).toBe("open");
    expect(signal.outcome.entryTouched).toBe(true);
  });
});

describe("CRT denetimi — şüphe 6: D/W/M yön kapısı", () => {
  const dwm = (formingHigh: number, formingLow: number) => [
    k(0, 98, 99, 97, 98),
    k(1, 96, 101, 95, 100), // C1
    k(2, 100, 101.4, 97, 99), // C2: high süpürüldü, içeride kapandı → short
    k(3, 99, formingHigh, formingLow, (formingHigh + formingLow) / 2, false) // C3 (oluşuyor)
  ];

  it("DÜZELTİLDİ (B7): üst CRT'nin C3'ü hedefi (C1 low) çoktan aldıysa o zaman dilimi yön vermez", () => {
    const read = readHtfCrt(dwm(99.5, 94), "1d");
    expect(read.direction).toBeUndefined();
    expect(read.spent).toBe("target");
    expect(readHtfCrt(dwm(99.5, 96), "1d").direction).toBe("short"); // hedefe varmadı → hâlâ yön
  });

  it("DÜZELTİLDİ (B7): C3, C2'nin süpürdüğü ucu (101.4) aşmışsa o zaman dilimi yön vermez", () => {
    const read = readHtfCrt(dwm(102.5, 98), "1d");
    expect(read.direction).toBeUndefined();
    expect(read.spent).toBe("invalidated");
  });

  it("DÜZELTİLDİ (B7): tükenmiş üst CRT kapıyı geçirmez ve özet nedeni söyler", () => {
    const base = withHtfCrts(createStructureContext(), { daily: "short" });
    const daily = base.timeframes.daily;
    const spent = { ...base, timeframes: { ...base.timeframes, daily: daily.map((candle, index) => index === daily.length - 1 ? { ...candle, low: 93 } : candle) } };
    const read = evaluateCrtHtfAlignment(spent, "4h", "short");
    expect(read.aligned).toBe(false);
    expect(read.summary).toContain("hedefi aldı");
  });

  it("DOĞRULANDI: 1W setup'ın yönü yalnız aylık CRT'den gelir", () => {
    const context = withHtfCrts(createStructureContext(), { daily: "short", weekly: "short" });
    const read = evaluateCrtHtfAlignment(context, "1w", "short");
    expect(read.required).toEqual(["1M"]);
    expect(read.aligned).toBe(false); // günlük ve haftalık short olsa da aylık CRT yok → blocker
  });
});

describe("CRT denetimi — şüphe 7: hedef yedeği", () => {
  it("ÇÜRÜTÜLDÜ (READY için): giriş her zaman range içinde, hedef her zaman C1'in karşı ucu", () => {
    const { signal } = scanShort();
    expect(signal.plan.targets[1]).toBeCloseTo(signal.crtAnchor!.rangeLow, 9);
  });

  it("ÇÜRÜTÜLDÜ (READY için): fikstür sinyalinde de hedef = range low", async () => {
    const signal = await createCrtSignal();
    expect(signal.stage).toBe("ready");
    expect(signal.plan.targets[1]).toBeCloseTo(signal.crtAnchor!.rangeLow, 9);
  });
});

describe("CRT denetimi — şüphe 8: skor/grade", () => {
  const base = {
    manipulation: true, choch: true, rr: 1.2, minimumRR: 1,
    htfAlignment: { aligned: true, fullyAligned: false }, smtAligned: false,
    locationTier: "fvg" as const, referenceCandleScore: 0, displacementStrength: "none" as const,
    shiftFvgOrRetest: false, rangeRespect: false, pdAligned: true
  };

  it("KISMEN: READY olabilen en zayıf setup 75 (B), en güçlüsü 100 (A+); kalite payı en fazla 31, yorumdaki 38 değil", () => {
    // READY için zorunlu: manipulation + ChoCH + RR + HTF aligned + key level (FVG en az) + PD.
    expect(scoreCrtSetup(base)).toBe(75);
    expect(scoreCrtSetup({
      ...base,
      htfAlignment: { aligned: true, fullyAligned: true }, smtAligned: true, locationTier: "weekly",
      referenceCandleScore: 100, displacementStrength: "strong", shiftFvgOrRetest: true, rangeRespect: true
    })).toBe(100);
  });
});

const RUN_TO_DOL: Array<[number, number, number, number]> = [
  [99.7, 99.8, 99.0, 99.1], [99.1, 99.2, 97.5, 97.6], [97.6, 97.7, 96.0, 96.1], [96.1, 96.2, 94.8, 95.0]
];

describe("CRT denetimi — B1: replay ölçümü (düzeltildi)", () => {
  it("DÜZELTİLDİ: READY'nin dolumu sinyalin kendi retest mumundan gelir; girişe dönmeden DOL'a giden işlem replay'de de tp2", () => {
    const atFill = scanShort({ after: [] }).signal;
    expect(atFill.stage).toBe("ready");
    expect(atFill.outcome.status).toBe("open");
    const future = scanShort({ after: RUN_TO_DOL }).context.timeframes.m15.slice(-RUN_TO_DOL.length);
    expect(Math.min(...future.map((candle) => candle.low))).toBeLessThanOrEqual(atFill.plan.targets[1]);
    expect(future.every((candle) => candle.high < atFill.plan.entry)).toBe(true);
    const replay = __runtimeReplayInternals.evaluateForwardOutcome(atFill, future);
    expect(replay.status).toBe("tp2");
    expect(replay.rMultiple).toBeGreaterThan(0);
  });
});

describe("CRT denetimi — B3: geçmiş yeniden yazılmıyor (düzeltildi)", () => {
  it("DÜZELTİLDİ: dolmuş ve DOL'a gitmiş işlem sonraki taramada aynı giriş ve tp2 ile kalır, 'tüketildi' olmaz", () => {
    const early = scanShort({ after: [] }).signal;
    const later = scanShort({ after: RUN_TO_DOL }).signal;
    expect(later.plan.entry).toBeCloseTo(early.plan.entry, 9);
    expect(later.plan.entryStatus).toBe("confirmed");
    expect(later.outcome.status).toBe("tp2");
    expect(later.governance.blockers.join(" ")).not.toContain("tüketildi");
  });
});

describe("huni scripti kapı sınıflandırması (scripts/crtFunnelGates.ts)", () => {
  it("ChoCH teşhisi: yalnız sweep sonrası pivotu kıran displacement → 'referans var, kırılmadı'", () => {
    const signal = scanShort({ breakSwing: false }).signal;
    expect(gateFlags(signal).choch).toBe(false);
    expect(chochFailureReason(signal)).toBe("not-broken");
  });

  it("READY setup tüm kapılardan geçer", () => {
    const flags = gateFlags(scanShort().signal);
    expect(depth(flags)).toBe(DEPTH_GATES.length);
  });

  it("üstte aktif D/W/M CRT yoksa setup D/W/M kapısında takılır", () => {
    const signal = scanShort({ daily: "none" }).signal;
    const flags = gateFlags(signal);
    expect(signal.stage).not.toBe("ready");
    expect(flags.entry).toBe(true);
    expect(flags.htf).toBe(false);
    expect(DEPTH_GATES[depth(flags)]).toBe("htf"); // günlük C1 high (1.01) hâlâ key level
  });
});
