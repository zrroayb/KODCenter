import { describe, expect, it } from "vitest";
import { __runtimeReplayInternals } from "../lib/backtest/runtimeReplay";
import { activeCrtRange } from "../lib/charts/crtRange";
import type { Candle, TradingSignal } from "../lib/ict/types";
import { crtStrategy, detectAnchorRaid, evaluateCrtHtfAlignment, scoreCrtSetup } from "../lib/strategies/crt/crt.strategy";
import { readHtfCrt } from "../lib/strategies/crt/htfCrt";
import { auditShortScenario, type AuditScenarioOptions } from "./crtAuditScenario";
import { createCrtSignal, createStructureContext, withHtfCrts } from "./strategyFixtures";
import { DEPTH_GATES, depth, gateFlags } from "../../scripts/crtFunnelGates";

// CRT DENETİMİ 2026-11 (docs/CRT_DENETIM_2026-11.md). Bu testler motorun BUGÜNKÜ davranışını
// sabitler — düzeltme DEĞİLDİR. Her test bir şüphenin karşı-örneğidir; düzeltme sahibi
// onaylayınca yapılır ve o zaman ilgili test bilerek ters çevrilir.

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

describe("CRT denetimi — şüphe 1: üç ayrı CRT tanımı", () => {
  it("DOĞRULANDI: C1 ile C2 arasında iç mum varken motor ve grafik/HTF okuması farklı C1 seçer", () => {
    const candles = [
      k(0, 98, 99, 97, 98),
      k(1, 96, 101, 95, 100), // motorun C1'i
      k(2, 99, 100, 97, 98.5), // iç mum (inside bar)
      k(3, 98.5, 101.6, 98, 99), // ikisini de süpürüp içeride kapanan mum
      k(4, 99, 99.2, 98.8, 99, false)
    ];
    const engine = detectAnchorRaid(candles, SPEC_4H);
    expect(engine.raid?.direction).toBe("short");
    expect(engine.range.high).toBe(101); // C1 = iki mum önceki
    expect(engine.range.low).toBe(95);

    const htf = readHtfCrt(candles, "1d");
    expect(htf.direction).toBe("short");
    expect(htf.c1?.high).toBe(100); // C1 = iç mum
    const chart = activeCrtRange(candles.slice(0, -1));
    expect(chart?.high).toBe(100);
    // Aynı veride: motor EQ 98 / hedef 95; grafik ve D/W/M okuması EQ 98.5 / hedef 97.
    expect(engine.range.midpoint).not.toBe(chart?.eq);
  });
});

describe("CRT denetimi — şüphe 2: C2 dışarıda kapanırsa", () => {
  it("KISMEN: C2 range dışında kapanıp sonraki mum içeri dönünce setup yaşar (READY olamaz, mesaj yanıltıcı)", () => {
    const candles = [
      k(0, 98, 99, 97, 98),
      k(1, 96, 101, 95, 100), // C1
      k(2, 100, 102, 99.8, 101.8), // C2: range ÜSTÜNDE kapandı = acceptance
      k(3, 101.8, 101.9, 98.5, 99), // sonraki mum içeri döndü
      k(4, 99, 99.2, 98.8, 99, false)
    ];
    const read = detectAnchorRaid(candles, SPEC_4H);
    // Kaynak: dışarıda kapanış = CRT geçersiz. Motor: raid canlı, yalnız "kapanmadı" işaretli.
    expect(read.raid?.direction).toBe("short");
    expect(read.raid?.closed).toBe(false);
    expect(read.range.high).toBe(101);
  });
});

describe("CRT denetimi — şüphe 3: ChoCH = True MSS mi?", () => {
  it("DOĞRULANDI: sweep sonrası mikro pivot kırılımı ChoCH sayılır; sweep öncesi swing low (True MSS) kırılmadan READY", () => {
    const { signal, context } = scanShort();
    expect(signal.stage).toBe("ready");
    const choch = signal.evidence.find((item) => item.id === "choch");
    // Kırılan seviye 1.003 = sweep'ten SONRA oluşan 1 mumluk pivot low.
    expect(choch?.price).toBeCloseTo(1.003, 6);
    // Sweep öncesi son 15m swing low 0.993 (C1'in son mumu); hiçbir kapanış 0.995'in bile altına inmedi.
    const closes = context.timeframes.m15.filter((candle) => candle.time >= Date.UTC(2026, 5, 10, 17)).map((candle) => candle.close);
    expect(Math.min(...closes)).toBeGreaterThanOrEqual(0.995);
  });
});

describe("CRT denetimi — şüphe 4: sıra (C2 kapanır → C3'te MSS → retest)", () => {
  it("DOĞRULANDI: ChoCH Candle 2'nin İÇİNDE oluşmuşken READY", () => {
    const { signal, c3Open } = scanShort();
    expect(signal.stage).toBe("ready");
    const choch = signal.evidence.find((item) => item.id === "choch");
    expect(choch?.time).toBeLessThan(c3Open); // C3 açılmadan önce
  });

  it("karşılaştırma: ChoCH C3 içinde olunca da READY (motor iki sırayı ayırmıyor)", () => {
    const { signal, c3Open } = scanShort({ chochInC3: true });
    expect(signal.stage).toBe("ready");
    expect(signal.evidence.find((item) => item.id === "choch")?.time).toBeGreaterThanOrEqual(c3Open);
  });
});

describe("CRT denetimi — şüphe 5: giriş / dolum", () => {
  it("DOĞRULANDI (yeni bulgu): FVG bölgesine dokunuş 'dolum' sayılır ama giriş fiyatı ChoCH seviyesidir — fiyat girişe hiç ulaşmadan READY", () => {
    const { signal, context } = scanShort(); // C3 retest mumu yalnız 0.9995'e çıktı
    expect(signal.stage).toBe("ready");
    expect(signal.plan.entryStatus).toBe("confirmed");
    expect(signal.plan.entry).toBeCloseTo(1.003, 6);
    const c3High = Math.max(...context.timeframes.m15.filter((candle) => candle.time >= Date.UTC(2026, 5, 10, 21)).map((candle) => candle.high));
    expect(c3High).toBeLessThan(signal.plan.entry); // giriş fiyatı hiç işlem görmedi
    expect(signal.outcome.status).toBe("not-triggered"); // canlı sonuç motoru da dolum görmüyor
  });

  it("ÇÜRÜTÜLDÜ (kısmen): giriş seviyesine gerçekten dokunulduğunda limit emir mantığıyla dokunuş = dolum doğrudur", () => {
    const { signal } = scanShort({ retestHigh: 100.35, retestClose: 99.8 });
    expect(signal.stage).toBe("ready");
    expect(signal.outcome.status).toBe("open");
  });
});

describe("CRT denetimi — şüphe 6: D/W/M yön kapısı", () => {
  const dwm = (formingHigh: number, formingLow: number) => [
    k(0, 98, 99, 97, 98),
    k(1, 96, 101, 95, 100), // C1
    k(2, 100, 101.4, 97, 99), // C2: high süpürüldü, içeride kapandı → short
    k(3, 99, formingHigh, formingLow, (formingHigh + formingLow) / 2, false) // C3 (oluşuyor)
  ];

  it("DOĞRULANDI: üst CRT'nin C3'ü hedefi (C1 low) çoktan aldıysa yön hâlâ short", () => {
    expect(readHtfCrt(dwm(99.5, 94), "1d").direction).toBe("short");
  });

  it("DOĞRULANDI: C3, C2'nin ucunu (geçersizlik) aşmışsa da yön hâlâ short", () => {
    expect(readHtfCrt(dwm(102.5, 98), "1d").direction).toBe("short");
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
  [99.8, 99.9, 99.0, 99.1], [99.1, 99.2, 97.5, 97.6], [97.6, 97.7, 96.0, 96.1], [96.1, 96.2, 94.8, 95.0]
];

describe("CRT denetimi — yeni bulgu: replay ölçümü canlıdan farklı", () => {
  it("DOĞRULANDI: READY'nin girişi geçmişte dolmuş olsa da replay GELECEKTE ikinci bir dokunuş ister; doğrudan hedefe giden işlem 'not-triggered' sayılır", () => {
    // Dolumdan hemen sonraki tarama: giriş 1.003'te doldu, READY.
    const atFill = scanShort({ retestHigh: 100.35, retestClose: 99.8, after: [] }).signal;
    expect(atFill.stage).toBe("ready");
    expect(atFill.outcome.status).toBe("open");
    // Sonra fiyat girişe dönmeden doğrudan DOL'a (0.95) iner: gerçek işlem +R ile kapanırdı.
    const future = scanShort({ retestHigh: 100.35, retestClose: 99.8, after: RUN_TO_DOL }).context.timeframes.m15.slice(-RUN_TO_DOL.length);
    expect(Math.min(...future.map((candle) => candle.low))).toBeLessThanOrEqual(atFill.plan.targets[1]);
    expect(future.every((candle) => candle.high < atFill.plan.entry)).toBe(true);
    const replay = __runtimeReplayInternals.evaluateForwardOutcome(atFill, future);
    expect(replay.status).toBe("not-triggered"); // kazanç ölçümden düşüyor
  });
});

describe("CRT denetimi — yeni bulgu: geçmiş yeniden yazılıyor", () => {
  it("DOĞRULANDI: dolmuş ve DOL'a gitmiş işlem, sonraki taramada ChoCH daha yeni bir pivota kaydığı için 'missed / EQ tüketildi' görünür", () => {
    const later = scanShort({ retestHigh: 100.35, retestClose: 99.8, after: RUN_TO_DOL }).signal;
    expect(later.stage).toBe("missed");
    expect(later.plan.entry).not.toBeCloseTo(1.003, 6); // giriş seviyesi değişti (0.994)
    expect(later.plan.entryStatus).toBe("pending");
    expect(later.governance.blockers.join(" ")).toContain("tüketildi");
    expect(later.outcome.status).not.toBe("tp2");
  });
});

describe("CRT denetimi — yeni bulgu: açık işlem de kayboluyor", () => {
  it("DOĞRULANDI: işlem açıkken (EQ görülmeden, stop olmadan) ChoCH yeni pivota kayınca sinyal READY/open'dan WATCH/pending'e döner", () => {
    const grind: Array<[number, number, number, number]> = [
      [99.8, 99.85, 99.3, 99.4], [99.4, 99.6, 99.35, 99.5], [99.5, 99.55, 99.0, 99.1]
    ];
    const open = scanShort({ retestHigh: 100.35, retestClose: 99.8, after: grind.slice(0, 2) }).signal;
    expect(open.stage).toBe("ready");
    expect(open.outcome.status).toBe("open");
    const later = scanShort({ retestHigh: 100.35, retestClose: 99.8, after: grind }).signal;
    expect(later.stage).toBe("watch");
    expect(later.plan.entryStatus).toBe("pending");
    expect(later.plan.entry).toBeCloseTo(0.999, 6); // giriş 1.003'ten kaydı
    expect(later.outcome.status).toBe("not-triggered"); // açık işlem artık izlenmiyor
  });
});

describe("huni scripti kapı sınıflandırması (scripts/crtFunnelGates.ts)", () => {
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
