// Gemini endpoints: payload types, prompts, local fallbacks and handlers (split from server/app.ts).
// Gemini never invents events: it interprets the deterministic evidence it is given.
import { dolBeManagementLine, TRADE_COMMENTARY_STAGE_RULE, tradeCommentaryViolation } from "../src/lib/gemini/commentaryGuard";
import { CRT_ANALYSIS_SYSTEM_INSTRUCTION } from "../src/lib/gemini/systemInstructions";
import { type YahooProxyResponse, type TelegramEnv, type JsonRequest, jsonResponse, readJsonBody, formatTelegramPrice, formatTelegramR, clampText } from "./http";

export type GeminiTradePayload = {
  id?: string;
  symbol?: string;
  direction?: string;
  stage?: string;
  grade?: string;
  score?: number;
  entry?: number;
  stopLoss?: number;
  targets?: number[];
  rr?: number;
  grossRR?: number;
  entryModel?: {
    source?: string;
    status?: string;
    retested?: boolean;
    cisdConfirmed?: boolean;
    fairValueGap?: {
      source?: string;
      direction?: string;
      low?: number;
      high?: number;
      midpoint?: number;
      mitigated?: boolean;
    };
  };
  context?: {
    monthlyBias?: string;
    weeklyBias?: string;
    dailyBias?: string;
    h4Bias?: string;
    h1Bias?: string;
    crtBias?: string;
    dol?: number;
    premiumDiscount?: string;
    session?: string;
    dataFeed?: string;
  };
  checklist?: Array<{
    label?: string;
    status?: string;
    explanation?: string;
  }>;
  warnings?: string[];
  invalidation?: string[];
  evidence?: Array<{
    label?: string;
    status?: string;
    detail?: string;
  }>;
  structureAudit?: {
    verdict?: string;
    headline?: string;
    decision?: string;
    items?: Array<{
      label?: string;
      status?: string;
      detail?: string;
    }>;
    simpleFacts?: string[];
  };
  chart?: {
    timeframe?: string;
    lastPrice?: number;
    decisionLine?: string;
    waitingFor?: string[];
    keyLevels?: Array<{
      label?: string;
      price?: number;
      zone?: [number, number];
      reason?: string;
    }>;
    annotations?: {
      sweep?: {
        side?: string;
        level?: number;
        candleIndex?: number;
        reclaimed?: boolean;
      };
      mss?: {
        direction?: string;
        level?: number;
        candleIndex?: number;
      };
      displacement?: {
        direction?: string;
        candleIndex?: number;
        bodyRatio?: number;
        rangeAtr?: number;
      };
      fairValueGap?: {
        source?: string;
        direction?: string;
        low?: number;
        high?: number;
        midpoint?: number;
        mitigated?: boolean;
        candleIndex?: number;
      };
      smt?: {
        partner?: string;
        side?: string;
        note?: string;
      };
    };
    recentCandles?: Array<{
      index?: number;
      time?: number;
      open?: number;
      high?: number;
      low?: number;
      close?: number;
      role?: string;
    }>;
  };
};

export type GeminiReplayPayload = {
  strategyId?: string;
  windowDays?: number;
  availableDays?: number;
  scannedWindows?: number;
  totals?: {
    trades?: number;
    triggeredTrades?: number;
    winRate?: number;
    profitFactor?: number;
    expectancyR?: number;
    totalR?: number;
    maxDrawdownR?: number;
    readyEntries?: number;
    watchSetups?: number;
    liveReadyEntries?: number;
    watchPromotedEntries?: number;
    tp?: number;
    stopped?: number;
    notTriggered?: number;
    open?: number;
  };
  bySymbol?: unknown[];
  calibration?: unknown[];
  filterScenarios?: unknown[];
  managementScenarios?: unknown[];
  setupBreakdowns?: unknown[];
  failureReasons?: unknown[];
  failureCases?: unknown[];
  watchReasonSummary?: unknown[];
  replayDiagnosis?: string[];
  sampleWarning?: string;
};

export type GeminiMarketPickPayload = {
  generatedAt?: number;
  dataSource?: string;
  marketCount?: number;
  candidates?: Array<{
    symbol?: string;
    direction?: string;
    stage?: string;
    grade?: string;
    score?: number;
    rr?: number;
    anchor?: string;
    entry?: number;
    stopLoss?: number;
    targets?: number[];
    summary?: string;
    governance?: string;
    blockers?: string[];
    warnings?: string[];
  }>;
};

export function cleanModelCommentary(value: string, max = 1200) {
  return clampText(
    value
      .replace(/\*\*/g, "")
      .replace(/^[-*]\s+/gm, "")
      .replace(/\bkesinlikle\b/gi, "şimdilik")
      .trim(),
    max
  );
}

export function fallbackTradeCommentary(input: GeminiTradePayload, reason?: string) {
  // CRT mentor fallback: address the first missing SOP step with distinct lines instead of
  // echoing the same audit sentence into both Neden and Beklenen.
  const audit = input.structureAudit;
  const evidenceStatus = (label: string) =>
    input.evidence?.find((item) => (item.label ?? "").toLowerCase().includes(label))?.status;
  const direction = (input.direction ?? "").toLowerCase();
  const geometryBroken = typeof input.entry === "number" && typeof input.stopLoss === "number"
    && (direction === "short" ? input.stopLoss <= input.entry : input.stopLoss >= input.entry);
  const decisionLine = input.chart?.decisionLine;
  const waiting = input.chart?.waitingFor?.[0];
  const riskLine = `Risk: ${formatTelegramR(input.rr)} · SL ${formatTelegramPrice(input.stopLoss)} · ${input.invalidation?.[0] || "Invalidation stop seviyesi."}`;

  let karar: string;
  let neden: string;
  let beklenen: string;
  if (input.stage === "invalidated") {
    karar = "Karar: Setup geçersiz; stop görüldü.";
    neden = `Neden: ${formatTelegramPrice(input.stopLoss)} invalidation seviyesi çalıştı; manipulation senaryosu bozuldu.`;
    beklenen = "Beklenen: Bu modelden uzak dur; yeni range mumu ve yeni manipulation sweep bekle.";
  } else if (input.stage === "missed") {
    karar = "Karar: Kovalama yok; trade kaçtı.";
    neden = "Neden: Entry retest'i verilmeden fiyat hedefe yürüdü; geç girişin RR'ı kalmadı.";
    beklenen = "Beklenen: Sonraki HTF mumunda yeni CRT dizilimi (sweep → ChoCH → retest) bekle.";
  } else if (geometryBroken) {
    karar = input.stage === "watch" ? "Karar: Bekle; plan geometrisi bozuk, trade edilmez." : "Karar: Trade edilmez; plan geometrisi bozuk.";
    neden = `Neden: Stop ${formatTelegramPrice(input.stopLoss)}, entry ${formatTelegramPrice(input.entry)} seviyesinin yanlış tarafında duruyor.`;
    beklenen = "Beklenen: Geçerli manipulation wick'i oluşup stop doğru tarafa oturana kadar sadece izle.";
  } else if (evidenceStatus("manipulation") === "fail") {
    karar = "Karar: Bekle; manipulation yok.";
    neden = "Neden: CRT range extremi henüz süpürülmedi; likidite alınmadan distribution başlamaz.";
    beklenen = `Beklenen: ${waiting || "Range extremi süpürülüp reclaim kapanışı gelsin."}`;
  } else if (evidenceStatus("choch") === "fail" || input.entryModel?.status !== "confirmed") {
    karar = "Karar: Bekle; karakter değişimi onayı eksik.";
    neden = "Neden: Sweep tamam ama ChoCH/Just kapanışı yok; şimdilik bu sadece likidite avı.";
    beklenen = `Beklenen: ${decisionLine || waiting || "LTF kapanışın manipulation başlangıç seviyesini kırması gerekiyor."}`;
  } else if (input.stage === "ready") {
    karar = "Karar: Plan hazır; disiplinle uygula.";
    neden = `Neden: ${audit?.decision || "CRT sırası tamam: bias, manipulation, ChoCH ve retest okunuyor."}`;
    beklenen = dolBeManagementLine(formatTelegramPrice(input.entry), formatTelegramPrice(input.targets?.[0]), formatTelegramPrice(input.targets?.[1] ?? input.targets?.[0]));
  } else {
    karar = "Karar: Bekle; onay geldi, retest gelsin, displacement kovalanmaz.";
    neden = `Neden: ${audit?.decision || decisionLine || "Kalite/RR filtreleri henüz READY vermiyor."}`;
    beklenen = `Beklenen: Fiyat ${formatTelegramPrice(input.entry)} retest seviyesine dönsün; temas + tutunma görmeden emir yok.`;
  }

  return {
    status: "fallback" as const,
    commentary: clampText([karar, neden, beklenen, riskLine].join("\n"), 900),
    model: "local-fallback",
    reason
  };
}

export function buildGeminiPrompt(input: GeminiTradePayload) {
  const plannedGap = input.entryModel?.fairValueGap;
  const plannedGapText = plannedGap
    ? `${plannedGap.source ?? "poi"} ${plannedGap.direction ?? ""} ${plannedGap.low}-${plannedGap.high}, midpoint=${plannedGap.midpoint}, mitigated=${plannedGap.mitigated}`
    : "planlı POI/FVG yok; olmayan zone uydurma";
  const checklist = (input.checklist ?? [])
    .slice(0, 10)
    .map((item) => `${item.label}: ${item.status} - ${item.explanation}`)
    .join("\n");
  const evidence = (input.evidence ?? [])
    .slice(0, 8)
    .map((item) => `${item.label}: ${item.status} - ${item.detail}`)
    .join("\n");
  const warnings = (input.warnings ?? []).slice(0, 8).join("\n");
  const invalidation = (input.invalidation ?? []).slice(0, 3).join("\n");
  const keyLevels = (input.chart?.keyLevels ?? [])
    .slice(0, 14)
    .map((level) => {
      const value = Array.isArray(level.zone)
        ? `${level.zone[0]}-${level.zone[1]}`
        : typeof level.price === "number"
          ? String(level.price)
          : "-";
      return `${level.label}: ${value} (${level.reason ?? "-"})`;
    })
    .join("\n");
  const recentCandles = (input.chart?.recentCandles ?? [])
    .slice(-18)
    .map((candle) => `#${candle.index} O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close}${candle.role ? ` role=${candle.role}` : ""}`)
    .join("\n");
  const waitingFor = (input.chart?.waitingFor ?? []).slice(0, 6).join("\n");
  const annotations = JSON.stringify(input.chart?.annotations ?? {}, null, 0);
  const structureAudit = JSON.stringify(input.structureAudit ?? {}, null, 0);

  return clampText(`
Sen deneyimli bir Candle Range Theory (CRT) mentorusun; öğrencinin chartını okuyup net ve doğrudan konuşursun.
CRT modelin 3 mum döngüsüdür: Candle 1 range'i (wick high/low ve %50 EQ) tanımlar; Candle 2 tek bir ucu fitille süpürür ve range içinde kapanır (manipulation); yalnız Candle 3 işlenir (distribution) — giriş Candle 3'ün süresi içinde dolmalı: Candle 2 kapanmadan girilmez (C2 içindeki retest sayılmaz), Candle 3 girişsiz kapanırsa CRT biter, C4 ve sonrası işlenmez. Power of 3: C3'ün ters fitili mumun başında oluşur; giriş C3'ün ikinci yarısındaysa (uyarılarda yazar) genişleme için süre az, boyutu küçültmesini söyle.
Zorunlu iki şart: CRT bir key level'da olmalı (eski HTF high/low, HTF FVG, açılış fiyatı) ve HTF trend yönünde olmalı. Key level'sız veya trend tersine CRT'ye "işlenmez" dersin; istisna yok.
SOP sıran: HTF bias/DOL uyumu → valid pullback → range extremi sweep + reclaim → LTF ChoCH/Just kapanışı → kırılan seviyenin retest'inden entry → stop manipulation wick'inin dışına → EQ (0.5) görülünce stop break-even'a → çıkış DOL (karşı likidite), pozisyonun tamamı; kısmi TP yok. Açık işlemde uyarılarda "Hedef iptal riski" (ters SMT + ters MSS) varsa: DOL hedefi kaynak kuralına göre iptal — çıkışı veya stop sıkılaştırmayı değerlendirmesini söyle; sistemin işlemi kapattığını asla söyleme.
Sıra disiplini bozulmaz: sweep yoksa "manipulation bekle" dersin, ChoCH yoksa "kapanış onayı bekle" dersin, retest kaçtıysa "kovalanmaz, yeni model bekle" dersin.
Stop entry'nin yanlış tarafındaysa veya TP entry'nin gerisindeyse bunu sert söyle: bu plan geometrisi bozuk, trade edilmez.
Zamanlamayı değerlendir: haftalık döngüde Pazartesi çoğu zaman sahte high/low, Salı/Çarşamba haftanın gerçek high/low'u, Perşembe/Cuma karşı uca genişleme. Mekanik saat kalıbı (4H 1/5/9 gibi) kural değildir.
Bu otomatik emir sistemi değildir; al/sat emri verme, kesinlik konuşma, yatırım tavsiyesi yazma.
Türkçe yaz. Teknik terimleri koru. Tam 4 kısa satır yaz.
${TRADE_COMMENTARY_STAGE_RULE}
StructureAudit gerçek kaynak. Audit ile çelişme, audit dışı pattern uydurma.
Chartı gerçekten oku: CRT range high/low/mid, DOL, POI, manipulation sweep, ChoCH/Just, entry, stop ve TP mesafesini beraber değerlendir.
Hangi mum/level bekleniyor ise açık söyle. "Şu mumun high/low kapanışı" gibi somut ol.
Eğer StructureAudit POI/FVG yok diyorsa zone varmış gibi konuşma.
Eğer chart verisi plana tersse bunu açıkça eleştir: "bu chartta POI teması yok", "entry chase olur", "stop zaten görülmüş" gibi.
Her satırın rolü farklıdır ve kopya satır yasaktır:
Karar = tek hüküm + kısa gerekçe (Bekle / Trade edilmez / Plan hazır / Kovalama yok gibi).
Neden = chart'taki mevcut kanıt; CRT sırasında hangi adımlar tamam, hangisi eksik.
Beklenen = bir SONRAKİ somut adım; hangi seviye, hangi mumun kapanışı, hangi retest.
Risk = plan seviyeleri ve RR yorumu.
Neden ile Beklenen'e asla aynı cümleyi yazma; ikisi aynı bilgiyi taşıyorsa yanlış yazıyorsun demektir.

Format:
Karar: ...
Neden: ...
Beklenen: ...
Risk: ...

Trade:
Symbol=${input.symbol}
Direction=${input.direction}
Stage=${input.stage}
Grade=${input.grade}
Score=${input.score}
Entry=${input.entry}
Stop=${input.stopLoss}
TP=${(input.targets ?? []).join(", ")}
NetRR=${input.rr}
GrossRR=${input.grossRR}
EntryModel=${input.entryModel?.source}/${input.entryModel?.status}, retest=${input.entryModel?.retested}, ChoCH/Just=${input.entryModel?.cisdConfirmed}
PlannedPOI=${plannedGapText}
Bias M/W/D/H4/H1=${input.context?.monthlyBias}/${input.context?.weeklyBias}/${input.context?.dailyBias}/${input.context?.h4Bias}/${input.context?.h1Bias}
CRTBias=${input.context?.crtBias}
DOL=${input.context?.dol}
PD=${input.context?.premiumDiscount}
Session=${input.context?.session}
Feed=${input.context?.dataFeed}

ChartRead:
Timeframe=${input.chart?.timeframe}
LastPrice=${input.chart?.lastPrice}
DecisionLine=${input.chart?.decisionLine}

StructureAudit:
${structureAudit || "-"}

KeyLevels:
${keyLevels || "-"}

WaitingFor:
${waitingFor || "-"}

ChartAnnotations:
${annotations || "-"}

RecentCandles:
${recentCandles || "-"}

Checklist:
${checklist || "-"}

Warnings:
${warnings || "-"}

Evidence:
${evidence || "-"}

Invalidation:
${invalidation || "-"}
`, 5000);
}

export function buildGeminiReplayPrompt(input: GeminiReplayPayload) {
  return clampText(`
Sen bir yatırım şirketinde çalışan kıdemli technical analyst ve CRT strateji kalibrasyon danışmanısın.
Bu otomatik emir sistemi değildir; yatırım tavsiyesi verme, kesinlik konuşma.
Türkçe yaz. Az ama öz ol. Replay datasına göre setup mantığını düzeltmeye odaklan.
WATCH-promoted ile live READY aynı şey değildir; bunu özellikle ayır.
Eğer istatistik kötüyse net söyle, yumuşatma.
Hard guardrail: Toplam tetiklenen trade 20'nin altındaysa hiçbir kural değişikliği, sembol durdurma veya setup kapatma önerme; yalnızca örneklem yetersiz de.
Bir sembol/setup/filtre hakkında hüküm vermek için o bucket'ta en az 8 tetiklenen trade olmalı.
NOT-TRIGGERED kayıtları performans örneklemine katma. EQ/TP gibi sonuç etiketlerini giriş filtresi sanma.

Format:
Karar: ...
Ana problem: ...
Kural değişikliği: ...
Sonraki ölçüm: ...

ReplaySummary:
${JSON.stringify({
    strategyId: input.strategyId,
    windowDays: input.windowDays,
    availableDays: input.availableDays,
    scannedWindows: input.scannedWindows,
    totals: input.totals,
    sampleWarning: input.sampleWarning
  }, null, 2)}

SymbolStats:
${JSON.stringify((input.bySymbol ?? []).slice(0, 8), null, 2)}

LocalCalibration:
${JSON.stringify((input.calibration ?? []).slice(0, 10), null, 2)}

FilterScenarios:
${JSON.stringify((input.filterScenarios ?? []).slice(0, 8), null, 2)}

ManagementScenarios (aynı girişler, farklı çıkış kuralı; "BE/partial'ı ölç" deme, burada ölçülü):
${JSON.stringify((input.managementScenarios ?? []).slice(0, 4), null, 2)}

SetupBreakdowns:
${JSON.stringify((input.setupBreakdowns ?? []).slice(0, 14), null, 2)}

FailureReasons:
${JSON.stringify((input.failureReasons ?? []).slice(0, 8), null, 2)}

WorstFailureCases:
${JSON.stringify((input.failureCases ?? []).slice(0, 10), null, 2)}

WatchReasons:
${JSON.stringify((input.watchReasonSummary ?? []).slice(0, 8), null, 2)}

ReplayDiagnosis:
${JSON.stringify(input.replayDiagnosis ?? [], null, 2)}
`, 6500);
}

export function extractGeminiText(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  if (typeof record.outputText === "string") return record.outputText;
  if (typeof record.text === "string") return record.text;
  const response = record.response;
  if (response && typeof response === "object") {
    const text = extractGeminiText(response);
    if (text) return text;
  }
  const steps = record.steps;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (!step || typeof step !== "object") continue;
      const stepRecord = step as Record<string, unknown>;
      if (stepRecord.type !== "model_output") continue;
      const content = stepRecord.content;
      if (!Array.isArray(content)) continue;
      const text = content
        .map((part) => part && typeof part === "object" ? (part as Record<string, unknown>).text : undefined)
        .filter((item): item is string => typeof item === "string")
        .join("\n")
        .trim();
      if (text) return text;
    }
  }
  const candidates = record.candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const content = (candidate as Record<string, unknown>).content;
      if (!content || typeof content !== "object") continue;
      const parts = (content as Record<string, unknown>).parts;
      if (!Array.isArray(parts)) continue;
      const text = parts
        .map((part) => part && typeof part === "object" ? (part as Record<string, unknown>).text : undefined)
        .filter((item): item is string => typeof item === "string")
        .join("\n")
        .trim();
      if (text) return text;
    }
  }
  return undefined;
}

export function buildGeminiMarketPickPrompt(input: GeminiMarketPickPayload) {
  return clampText(`
Sen bir prop firmada masa şefisin; sabah taramasında junior trader'a hangi setup'ın alınacağını söylüyorsun.
Bu yatırım tavsiyesi değil, sistem içi analiz notudur; ama kaçamak konuşma — TEK bir tercih söyle.
Türkçe yaz, 3-5 cümle. Format: "Masa görüşü:" ile başla.
Kurallar:
- Adaylardan BİRİNİ seç ve nedenini söyle (stage/skor/RR/blocker karşılaştır).
- İkinci adayı neden tercih etmediğini tek cümlede söyle ("şu daha mantıklı çünkü ...").
- Seçtiğin READY değilse "henüz alınmaz, şunu bekle" de; hiçbir aday sağlam değilse "bugün hiçbir şey alma" de.
- Kararı neyin çevireceğini söyle (onay kapanışı / stop bozulması).
- dataSource "demo" ise gerçek karar verilmeyeceğini ekle.

Adaylar (sıralı):
${JSON.stringify((input.candidates ?? []).slice(0, 6), null, 2)}

Bağlam:
${JSON.stringify({ dataSource: input.dataSource, marketCount: input.marketCount }, null, 2)}
`, 5200);
}

export function fallbackMarketPick(input: GeminiMarketPickPayload, reason?: string) {
  const candidates = input.candidates ?? [];
  const demoNote = input.dataSource === "demo" ? " (Dikkat: veri demo fallback — gerçek karar verme.)" : "";
  if (!candidates.length) {
    return {
      status: "fallback" as const,
      model: "local-fallback",
      reason,
      commentary: `Masa görüşü: Alınabilir aday yok. Bence hiçbir şey alma; yeni raid bekle.${demoNote}`
    };
  }
  const [pick, second] = candidates;
  const parts = [
    pick.stage === "ready" && !(pick.blockers ?? []).length
      ? `Masa görüşü: Bence ${pick.symbol} ${String(pick.direction).toUpperCase()} alınır — READY, skor ${pick.score}, RR ${pick.rr}.`
      : `Masa görüşü: En mantıklı aday ${pick.symbol} ${String(pick.direction).toUpperCase()} (skor ${pick.score}, RR ${pick.rr}) ama henüz alınmaz${(pick.blockers ?? [])[0] ? `: ${(pick.blockers ?? [])[0]}` : "."}`
  ];
  if (second) parts.push(`${second.symbol} ikinci sırada; skor/RR olarak daha zayıf.`);
  return { status: "fallback" as const, model: "local-fallback", reason, commentary: clampText(parts.join(" ") + demoNote, 900) };
}

export async function generateGeminiMarketPick(input: GeminiMarketPickPayload, env: TelegramEnv) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  if (!apiKey) {
    return { status: "disabled" as const, reason: "GEMINI_API_KEY missing" };
  }

  const timeouts = [14_000, 8_000];
  let lastError = "";
  for (let attempt = 0; attempt < timeouts.length; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(new Error("Gemini upstream timeout")), timeouts[attempt]);
    try {
      const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildGeminiMarketPickPrompt(input) }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 640 }
        }),
        signal: controller.signal
      });
      const body = await upstream.json().catch(async () => ({ error: await upstream.text().catch(() => "") }));
      if (!upstream.ok) {
        lastError = JSON.stringify(body).slice(0, 900);
        if (attempt === 0 && (upstream.status === 429 || upstream.status >= 500)) continue;
        return fallbackMarketPick(input, lastError);
      }
      const commentary = extractGeminiText(body)?.trim();
      if (!commentary) {
        lastError = "Gemini boş masa görüşü döndürdü.";
        if (attempt === 0) continue;
        return fallbackMarketPick(input, lastError);
      }
      return { status: "ready" as const, commentary: cleanModelCommentary(commentary, 900), model };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === timeouts.length - 1) return fallbackMarketPick(input, lastError);
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }
  return fallbackMarketPick(input, lastError || "Gemini masa görüşü alınamadı.");
}

export async function generateGeminiTradeCommentary(input: GeminiTradePayload, env: TelegramEnv) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  if (!apiKey) {
    return { status: "disabled" as const, reason: "GEMINI_API_KEY missing" };
  }

  const timeouts = [18_000, 10_000];
  let lastError = "";
  for (let attempt = 0; attempt < timeouts.length; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(new Error("Gemini upstream timeout")), timeouts[attempt]);
    try {
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildGeminiPrompt(input) }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 640 }
      }),
      signal: controller.signal
    });
    const body = await upstream.json().catch(async () => ({ error: await upstream.text().catch(() => "") }));
    if (!upstream.ok) {
      lastError = JSON.stringify(body).slice(0, 900);
      if (attempt === 0 && (upstream.status === 429 || upstream.status >= 500)) continue;
      return fallbackTradeCommentary(input, lastError);
    }
    const commentary = extractGeminiText(body)?.trim();
    if (!commentary) {
      lastError = "Gemini boş yorum döndürdü.";
      if (attempt === 0) continue;
      return fallbackTradeCommentary(input, lastError);
    }
    const cleaned = cleanModelCommentary(commentary, 900);
    const violation = tradeCommentaryViolation(cleaned, input.stage);
    if (violation) return fallbackTradeCommentary(input, violation);
    return { status: "ready" as const, commentary: cleaned, model };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === timeouts.length - 1) return fallbackTradeCommentary(input, lastError);
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }
  return fallbackTradeCommentary(input, lastError || "Gemini yorumu alınamadı.");
}

// Master §10/§14/§15: the CRT interpretation layer. Gemini gets deterministic evidence events
// (each with a unique id) and returns validated JSON — it must not invent events, and may only
// reference provided event ids. Additive endpoint; the freeform mentor commentary is untouched.

export const CRT_ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    directional_analysis: {
      type: "object",
      properties: {
        bias: { type: "string", enum: ["bullish", "bearish", "neutral"] },
        confidence: { type: "number" },
        external_draw: { type: "string" },
        reasoning: { type: "string" },
        supporting_event_ids: { type: "array", items: { type: "string" } },
        contradicting_event_ids: { type: "array", items: { type: "string" } }
      },
      required: ["bias", "reasoning"]
    },
    crt_analysis: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["candidate", "developing", "confirmed", "late", "invalid", "insufficient_evidence"] },
        direction: { type: "string", enum: ["bullish", "bearish", "none"] },
        reference_candle_quality: { type: "string", enum: ["high", "medium", "low", "invalid"] },
        reference_candle_reasoning: { type: "string" },
        sweep_reasoning: { type: "string" },
        confirmation_reasoning: { type: "string" },
        target_reasoning: { type: "string" },
        invalidation_reasoning: { type: "string" }
      },
      required: ["status", "direction"]
    },
    important_evidence: { type: "array", items: { type: "string" } },
    contradictions: { type: "array", items: { type: "string" } },
    missing_evidence: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    plain_language_summary: { type: "string" }
  },
  required: ["directional_analysis", "crt_analysis", "plain_language_summary"]
};

export async function generateGeminiCrtAnalysis(payload: Record<string, unknown>, env: TelegramEnv) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  if (!apiKey) return { status: "disabled" as const, reason: "GEMINI_API_KEY missing" };
  const events = Array.isArray((payload as { events?: unknown }).events) ? (payload as { events: Array<{ id?: string }> }).events : [];
  const knownIds = new Set(events.map((event) => event?.id).filter((id): id is string => typeof id === "string"));
  const prompt = `Interpret this deterministic CRT evidence. Reference only these event ids.\n${JSON.stringify(payload).slice(0, 16_000)}`;
  const controller = new AbortController();
  // Structured output with a response schema is heavier than the freeform commentary; give it room.
  const timeoutId = globalThis.setTimeout(() => controller.abort(new Error("Gemini upstream timeout")), 30_000);
  try {
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: CRT_ANALYSIS_SYSTEM_INSTRUCTION }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: "application/json", responseSchema: CRT_ANALYSIS_RESPONSE_SCHEMA }
      }),
      signal: controller.signal
    });
    const body = await upstream.json().catch(async () => ({ error: await upstream.text().catch(() => "") }));
    if (!upstream.ok) return { status: "error" as const, error: JSON.stringify(body).slice(0, 600) };
    const text = extractGeminiText(body)?.trim();
    if (!text) return { status: "error" as const, error: "Gemini boş analiz döndürdü." };
    // Even with responseMimeType JSON some models wrap the payload in a ```json fence; strip it.
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    const candidate = jsonStart >= 0 && jsonEnd > jsonStart ? cleaned.slice(jsonStart, jsonEnd + 1) : cleaned;
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(candidate) as Record<string, unknown>; }
    catch { return { status: "error" as const, error: `Gemini yanıtı geçerli JSON değil: ${text.slice(0, 200)}` }; }
    const da = parsed.directional_analysis as Record<string, unknown> | undefined;
    const ca = parsed.crt_analysis as Record<string, unknown> | undefined;
    if (!da?.bias || !ca?.status || typeof parsed.plain_language_summary !== "string") {
      return { status: "error" as const, error: "Zorunlu analiz alanları eksik." };
    }
    const referenced = [
      ...(Array.isArray(da.supporting_event_ids) ? da.supporting_event_ids : []),
      ...(Array.isArray(da.contradicting_event_ids) ? da.contradicting_event_ids : [])
    ].filter((id): id is string => typeof id === "string");
    const unknownId = referenced.find((id) => !knownIds.has(id));
    if (unknownId) return { status: "error" as const, error: `Gemini bilinmeyen event id kullandı: ${unknownId}` };
    return { status: "ready" as const, analysis: parsed, model };
  } catch (error) {
    return { status: "error" as const, error: error instanceof Error ? error.message : String(error) };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function handleGeminiCrtAnalysis(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { status: "error", error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readJsonBody(request) as Record<string, unknown>;
    const result = await generateGeminiCrtAnalysis(payload, env);
    jsonResponse(response, result.status === "error" ? 502 : 200, result);
  } catch (error) {
    jsonResponse(response, 400, { status: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

export const REPLAY_REASON_LABELS: Record<string, string> = {
  "clean-model": "temiz model",
  "dol-be": "DOL tam çıkış (EQ'da BE)",
  "eq-full": "EQ tam çıkış",
  "eq-then-be": "EQ sonrası BE",
  "dol-missed": "DOL gelmedi",
  "stop-too-tight": "stop gürültü bandında",
  "no-follow-through": "momentum EQ'ya taşımadı",
  "be-scratch": "BE scratch (0R)",
  "event-risk": "event riski",
  "range-chop": "range/chop rejimi",
  "htf-conflict": "HTF tam ters",
  "partial-htf-conflict": "HTF kısmi ters",
  "entry-not-filled": "entry dolmadı",
  "entry-expired": "retest emri zaman aşımı",
  expired: "süre doldu",
  unknown: "sınıflandırılamadı"
};

export function fallbackReplayReview(input: GeminiReplayPayload, reason?: string) {
  // CRT mentor replay review: honest about sample size, concrete about the losers,
  // and no rule-change advice that the data cannot support.
  const totals = input.totals ?? {};
  const setupBreakdowns = (input.setupBreakdowns ?? []) as Array<Record<string, unknown>>;
  const failureReasons = (input.failureReasons ?? []) as Array<Record<string, unknown>>;
  const failureCases = (input.failureCases ?? []) as Array<Record<string, unknown>>;
  const filterScenarios = (input.filterScenarios ?? []) as Array<Record<string, unknown>>;
  const managementScenarios = (input.managementScenarios ?? []) as Array<Record<string, unknown>>;
  const expectancy = typeof totals.expectancyR === "number" ? totals.expectancyR : 0;
  const profitFactor = typeof totals.profitFactor === "number" ? totals.profitFactor : 0;
  const triggered = typeof totals.triggeredTrades === "number" ? totals.triggeredTrades : 0;
  const liveReady = typeof totals.liveReadyEntries === "number" ? totals.liveReadyEntries : 0;
  const watchPromoted = typeof totals.watchPromotedEntries === "number" ? totals.watchPromotedEntries : 0;
  const smallSample = triggered < 20;

  const karar = triggered === 0
    ? "Karar: Replay'de tetiklenen trade yok; disiplin kapıları çalışıyor, hüküm için veri yok."
    : smallSample
      ? `Karar: ${triggered} trade istatistik değildir; expectancy ${expectancy.toFixed(2)}R / PF ${profitFactor.toFixed(2)} sayısal olarak kötü ama örneklem hüküm vermeye yetmez.`
      : `Karar: Replay edge ${expectancy >= 0 ? "pozitif" : "negatif"}; expectancy ${expectancy.toFixed(2)}R, PF ${profitFactor.toFixed(2)} (${triggered} trade).`;

  const caseLine = failureCases.slice(0, 2).map((item) => {
    const label = REPLAY_REASON_LABELS[String(item.outcomeReason ?? "")] ?? String(item.outcomeReason ?? "?");
    const maxFav = typeof item.maxFavorableR === "number" ? ` maxFav ${item.maxFavorableR.toFixed(2)}R` : "";
    return `${String(item.symbol ?? "?")} ${String(item.direction ?? "")} (${label}${maxFav})`;
  }).join(", ");
  const topFailure = failureReasons[0];
  const anaProblem = caseLine
    ? `Ana problem: kaybedenler ${caseLine}; live READY ${liveReady}, WATCH-promoted ${watchPromoted}.`
    : topFailure
      ? `Ana problem: ${REPLAY_REASON_LABELS[String(topFailure.reason)] ?? String(topFailure.reason)} ${String(topFailure.count)} kez / ${String(topFailure.totalR)}R; live READY ${liveReady}, WATCH-promoted ${watchPromoted}.`
      : `Ana problem: kayıp bucket'ı yok; live READY ${liveReady}, WATCH-promoted ${watchPromoted}.`;

  const worstSetup = setupBreakdowns.find((item) => item.verdict === "avoid" && Number(item.triggered ?? 0) >= 8);
  // Management counterfactuals arrive measured (same entries, different exit rule): report
  // the comparison instead of recommending "measure BE/partial" as a to-do.
  const modelMgmt = managementScenarios.find((item) => item.id === "model");
  const betterMgmt = managementScenarios
    .filter((item) => item.verdict === "better")
    .sort((a, b) => Number(b.deltaR ?? 0) - Number(a.deltaR ?? 0))[0];
  const kural = smallSample
    ? "Kural değişikliği: Yok — bu örneklemle kural değiştirmek overfit olur; aynı kurallarla veri biriktir."
    : worstSetup
      ? `Kural değişikliği: ${String(worstSetup.label)} READY'den WATCH'a düşsün (${String(worstSetup.expectancyR)}R, ${String(worstSetup.triggered)} trade).`
      : betterMgmt
        ? `Kural değişikliği: yönetim ölçümünde "${String(betterMgmt.label)}" mevcut modeli geçti (${String(betterMgmt.expectancyR)}R vs ${String(modelMgmt?.expectancyR ?? "?")}R, Δ+${String(betterMgmt.deltaR)}R); bir replay penceresi daha doğrulayıp geçmeyi düşün.`
        : modelMgmt
          ? `Kural değişikliği: Yok — BE/partial varyantları ölçüldü, mevcut model (${String(modelMgmt.expectancyR)}R) en iyisi ya da farkı anlamsız.`
          : "Kural değişikliği: Tek bir setup bucket'ı suçlu değil; yönetim (BE/partial) senaryolarını ölç.";

  const bestFilter = filterScenarios.find((item) => item.verdict === "edge" && Number(item.triggered ?? 0) >= 8);
  const olcum = bestFilter
    ? `Sonraki ölçüm: ${String(bestFilter.label)} filtresini tekrar ölç (${String(bestFilter.expectancyR)}R, PF ${String(bestFilter.profitFactor)}).`
    : `Sonraki ölçüm: ${smallSample ? "1-2 hafta daha canlı veri biriktirip aynı replay'i tekrar çalıştır." : "Live READY / HTF aligned / session içi filtrelerini ayrı ayrı ölç."}`;

  return {
    status: "fallback" as const,
    commentary: clampText([karar, anaProblem, kural, olcum].join("\n"), 1200),
    model: "local-fallback",
    reason
  };
}

export async function generateGeminiReplayReview(input: GeminiReplayPayload, env: TelegramEnv) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  if (!apiKey) {
    return { status: "disabled" as const, reason: "GEMINI_API_KEY missing" };
  }

  const timeouts = [20_000, 10_000];
  let lastError = "";
  for (let attempt = 0; attempt < timeouts.length; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(new Error("Gemini upstream timeout")), timeouts[attempt]);
    try {
      const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildGeminiReplayPrompt(input) }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 640 }
        }),
        signal: controller.signal
      });
      const body = await upstream.json().catch(async () => ({ error: await upstream.text().catch(() => "") }));
      if (!upstream.ok) {
        lastError = JSON.stringify(body).slice(0, 900);
        if (attempt === 0 && (upstream.status === 429 || upstream.status >= 500)) continue;
        return fallbackReplayReview(input, lastError);
      }
      const commentary = extractGeminiText(body)?.trim();
      if (!commentary) {
        lastError = "Gemini boş replay yorumu döndürdü.";
        if (attempt === 0) continue;
        return fallbackReplayReview(input, lastError);
      }
      return { status: "ready" as const, commentary: cleanModelCommentary(commentary, 1200), model };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === timeouts.length - 1) return fallbackReplayReview(input, lastError);
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }
  return fallbackReplayReview(input, lastError || "Gemini replay yorumu alınamadı.");
}

export async function handleGeminiTradeCommentary(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { status: "error", error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readJsonBody(request) as GeminiTradePayload;
    const result = await generateGeminiTradeCommentary(payload, env);
    jsonResponse(response, 200, result);
  } catch (error) {
    jsonResponse(response, 400, { status: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

export async function handleGeminiMarketPick(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { status: "error", error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readJsonBody(request) as GeminiMarketPickPayload;
    const result = await generateGeminiMarketPick(payload, env);
    jsonResponse(response, 200, result);
  } catch (error) {
    jsonResponse(response, 400, { status: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

export async function handleGeminiReplayReview(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { status: "error", error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readJsonBody(request) as GeminiReplayPayload;
    const result = await generateGeminiReplayReview(payload, env);
    jsonResponse(response, 200, result);
  } catch (error) {
    jsonResponse(response, 400, { status: "error", error: error instanceof Error ? error.message : String(error) });
  }
}
