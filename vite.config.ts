import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import process from "node:process";
import type { IncomingMessage, ServerResponse } from "node:http";

const yahooUserAgent = "Mozilla/5.0";

type YahooProxyRequest = IncomingMessage;

type YahooProxyResponse = ServerResponse;

type ReadyTelegramPayload = {
  id?: string;
  symbol?: string;
  direction?: string;
  alertKind?: string;
  rangeTf?: string;
  confirmTf?: string;
  rangeHigh?: number;
  rangeLow?: number;
  raidClosed?: boolean;
  grade?: string;
  score?: number;
  stage?: string;
  entry?: number;
  stopLoss?: number;
  targets?: number[];
  rr?: number;
  grossRR?: number;
  reasons?: string[];
  riskPct?: number;
  priority?: string;
  aiCommentary?: string;
  tradeContext?: GeminiTradePayload;
  charts?: Array<{ label?: string; dataUrl?: string }>;
};

type GeminiTradePayload = {
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

type GeminiReplayPayload = {
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

type GeminiMarketPickPayload = {
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

type TelegramEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GEMINI_MODEL?: string;
};

type JsonRequest = IncomingMessage;

function jsonResponse(response: YahooProxyResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

function readJsonBody(request: JsonRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTelegramPrice(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(5);
}

function formatTelegramR(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? `1:${value.toFixed(2)}` : "-";
}

function telegramCaption(payload: ReadyTelegramPayload) {
  const reasons = (payload.reasons ?? []).slice(0, 5).map((reason) => `- ${escapeHtml(reason)}`).join("\n");
  if (payload.alertKind === "raid") {
    return [
      `<b>CRT RAID</b> ${escapeHtml(payload.symbol ?? "-")} ${escapeHtml((payload.direction ?? "").toUpperCase())} (${escapeHtml(payload.rangeTf ?? "?")})`,
      `Range: <b>${formatTelegramPrice(payload.rangeLow)}</b> - <b>${formatTelegramPrice(payload.rangeHigh)}</b>${payload.raidClosed ? " · raid mumu içeri kapandı" : " · raid canlı"}`,
      "",
      `${escapeHtml(payload.confirmTf ?? "LTF")} ChoCH/Just kapanışı + retest bekleniyor. Bu bir entry sinyali DEĞİL, hazırlık uyarısıdır.`,
      "",
      reasons || "- Raid + reclaim aktif"
    ].join("\n");
  }
  if (payload.alertKind === "context") {
    return [
      `<b>CRT CONTEXT</b> ${escapeHtml(payload.symbol ?? "-")} ${escapeHtml((payload.direction ?? "").toUpperCase())} (${escapeHtml(payload.rangeTf ?? "?")})`,
      `Range: <b>${formatTelegramPrice(payload.rangeLow)}</b> - <b>${formatTelegramPrice(payload.rangeHigh)}</b>`,
      "",
      `${escapeHtml(payload.confirmTf ?? "LTF")} ChoCH/Just + POI/retest bekleniyor. Bu bir entry sinyali DEĞİL, takip uyarısıdır.`,
      "",
      reasons || "- HTF CRT yön verdi"
    ].join("\n");
  }
  const eqTarget = payload.targets?.[0];
  const dolTarget = payload.targets?.[1] ?? payload.targets?.[0];
  const aiCommentary = payload.aiCommentary?.trim()
    ? ["", "<b>AI Yorumu</b>", escapeHtml(payload.aiCommentary.trim())]
    : [];
  const priorityTag = payload.priority === "high" ? "READY SETUP" : payload.priority === "normal" ? "READY (orta grade)" : "READY (düşük grade · küçük boyut)";
  const riskLine = typeof payload.riskPct === "number"
    ? `Önerilen risk: <b>%${payload.riskPct}</b> (grade'e göre boyut)`
    : undefined;
  return [
    `<b>${priorityTag}</b> ${escapeHtml(payload.symbol ?? "-")} ${escapeHtml((payload.direction ?? "").toUpperCase())}`,
    `${escapeHtml(payload.grade ?? "-")} · Score ${payload.score ?? "-"} · Net RR ${formatTelegramR(payload.rr)}`,
    ...(riskLine ? [riskLine] : []),
    "",
    `Entry: <b>${formatTelegramPrice(payload.entry)}</b>`,
    `Stop: <b>${formatTelegramPrice(payload.stopLoss)}</b>`,
    `EQ / TP1: <b>${formatTelegramPrice(eqTarget)}</b>`,
    `DOL / TP2: <b>${formatTelegramPrice(dolTarget)}</b>`,
    "",
    "<b>Neden READY?</b>",
    reasons || "- Entry/SL/TP planı aktif",
    ...aiCommentary
  ].join("\n");
}

function clampText(value: unknown, max = 2800) {
  const text = typeof value === "string" ? value : "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function cleanModelCommentary(value: string, max = 1200) {
  return clampText(
    value
      .replace(/\*\*/g, "")
      .replace(/^[-*]\s+/gm, "")
      .replace(/\bkesinlikle\b/gi, "şimdilik")
      .trim(),
    max
  );
}

function fallbackTradeCommentary(input: GeminiTradePayload, reason?: string) {
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
    karar = "Karar: Trade edilmez; plan geometrisi bozuk.";
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
    beklenen = `Beklenen: Entry ${formatTelegramPrice(input.entry)}; EQ seviyesinde kısmi al, kalanı DOL'a taşı.`;
  } else {
    karar = "Karar: Onay geldi; retest bekle, displacement kovalanmaz.";
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

function buildGeminiPrompt(input: GeminiTradePayload) {
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
CRT modelin: bir önceki kapanmış HTF mumu range'dir. Range high/low'unun süpürülmesi manipulation, karşı tarafa dönen hareket distribution'dır.
SOP sıran: HTF bias/DOL uyumu → valid pullback → range extremi sweep + reclaim → LTF ChoCH/Just kapanışı → kırılan seviyenin retest'inden entry → stop manipulation wick'inin dışına → TP1 range EQ (0.5) → TP2 DOL veya range karşı ucu.
Sıra disiplini bozulmaz: sweep yoksa "manipulation bekle" dersin, ChoCH yoksa "kapanış onayı bekle" dersin, retest kaçtıysa "kovalanmaz, yeni model bekle" dersin.
Stop entry'nin yanlış tarafındaysa veya TP entry'nin gerisindeyse bunu sert söyle: bu plan geometrisi bozuk, trade edilmez.
Killzone dışı FX/endeks setup'ı zayıftır; zamanlamayı her zaman değerlendir.
Bu otomatik emir sistemi değildir; al/sat emri verme, kesinlik konuşma, yatırım tavsiyesi yazma.
Türkçe yaz. Teknik terimleri koru. Tam 4 kısa satır yaz.
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

function buildGeminiReplayPrompt(input: GeminiReplayPayload) {
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

function extractGeminiText(body: unknown): string | undefined {
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

function buildGeminiMarketPickPrompt(input: GeminiMarketPickPayload) {
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

function fallbackMarketPick(input: GeminiMarketPickPayload, reason?: string) {
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

async function generateGeminiMarketPick(input: GeminiMarketPickPayload, env: TelegramEnv) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
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

async function generateGeminiTradeCommentary(input: GeminiTradePayload, env: TelegramEnv) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
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
    return { status: "ready" as const, commentary: cleanModelCommentary(commentary, 900), model };
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
const CRT_ANALYSIS_SYSTEM_INSTRUCTION = `You are the interpretation layer of a deterministic Candle Range Theory trading system. You do NOT detect market events. All candles, ranges, structure breaks, liquidity sweeps, displacement events, targets and invalidation levels come only from the supplied evidence events. Reasoning order: external liquidity draw -> HTF structure -> dealing-range location -> liquidity sweep -> return inside -> displacement -> LTF confirmation -> target -> invalidation. Do not force a directional conclusion. Do not invent missing evidence. Do not assume every large candle is a valid CRT reference candle or every wick a valid sweep. You may only reference event ids present in the events array. The "knowledge" array holds reference CRT definitions — use them to ground your reasoning, but they are NOT market facts and you must not treat them as events. If evidence is insufficient set crt_analysis.status to "insufficient_evidence". Keep every reasoning/summary field concise — one or two short sentences, at most ~35 words each — so the JSON stays complete. Return ONLY valid JSON matching the schema.`;

const CRT_ANALYSIS_RESPONSE_SCHEMA = {
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

async function generateGeminiCrtAnalysis(payload: Record<string, unknown>, env: TelegramEnv) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
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

async function handleGeminiCrtAnalysis(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
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

const SESSION_ANALYSIS_SYSTEM_INSTRUCTION = `You are the interpretation layer of a deterministic CRT and trading-session analysis system.
You do not independently detect sessions, ranges, candles, sweeps, structure breaks, FVGs, displacement events, entries, stops or targets.
Every market fact comes only from deterministic_events in the supplied payload.
Explain the sequence in this order: HTF draw -> locked reference-session range -> trigger-session interaction -> sweep versus acceptance -> reclaim -> displacement -> lower-timeframe CRT confirmation -> target -> invalidation.
Do not infer a bullish setup only because a low was swept, or a bearish setup only because a high was swept.
Do not change timestamps, range prices, direction, lifecycle status, score or plan levels.
Reference only event ids supplied in deterministic_events. If evidence is incomplete, return developing or insufficient_evidence.
Keep the answer concise and return ONLY valid JSON matching the response schema.`;

const SESSION_ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["confirmed", "developing", "weak", "invalid", "insufficient_evidence"] },
    session_alignment: { type: "string", enum: ["strong", "moderate", "weak", "conflicting"] },
    summary: { type: "string" },
    sequence: { type: "array", items: { type: "string" } },
    missing_evidence: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    supporting_event_ids: { type: "array", items: { type: "string" } }
  },
  required: ["verdict", "session_alignment", "summary", "sequence", "missing_evidence", "risks", "supporting_event_ids"]
};

async function generateGeminiSessionAnalysis(payload: Record<string, unknown>, env: TelegramEnv) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
  if (!apiKey) return { status: "disabled" as const, reason: "GEMINI_API_KEY missing" };
  const events = Array.isArray(payload.deterministic_events)
    ? payload.deterministic_events as Array<{ id?: unknown }>
    : [];
  const knownIds = new Set(events.map((event) => event.id).filter((id): id is string => typeof id === "string"));
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(new Error("Gemini upstream timeout")), 30_000);
  try {
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SESSION_ANALYSIS_SYSTEM_INSTRUCTION }] },
        contents: [{ parts: [{ text: `Explain this deterministic CRT_SESSION setup.\n${JSON.stringify(payload).slice(0, 16_000)}` }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2_048,
          responseMimeType: "application/json",
          responseSchema: SESSION_ANALYSIS_RESPONSE_SCHEMA
        }
      }),
      signal: controller.signal
    });
    const body = await upstream.json().catch(async () => ({ error: await upstream.text().catch(() => "") }));
    if (!upstream.ok) return { status: "error" as const, error: JSON.stringify(body).slice(0, 600) };
    const text = extractGeminiText(body)?.trim();
    if (!text) return { status: "error" as const, error: "Gemini boş session analizi döndürdü." };
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const referenced = Array.isArray(parsed.supporting_event_ids)
      ? parsed.supporting_event_ids.filter((id): id is string => typeof id === "string")
      : [];
    const unknown = referenced.find((id) => !knownIds.has(id));
    if (unknown) return { status: "error" as const, error: `Gemini bilinmeyen session event id kullandı: ${unknown}` };
    if (typeof parsed.summary !== "string" || typeof parsed.verdict !== "string" || typeof parsed.session_alignment !== "string") {
      return { status: "error" as const, error: "Session analizinin zorunlu alanları eksik." };
    }
    return { status: "ready" as const, model, analysis: parsed };
  } catch (error) {
    return { status: "error" as const, error: error instanceof Error ? error.message : String(error) };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function handleGeminiSessionAnalysis(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { status: "error", error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readJsonBody(request) as Record<string, unknown>;
    const result = await generateGeminiSessionAnalysis(payload, env);
    jsonResponse(response, result.status === "error" ? 502 : 200, result);
  } catch (error) {
    jsonResponse(response, 400, { status: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

// Master §33-§34: Silver Bullet interpretation layer — deterministic facts in, validated JSON
// out; a post-11:00 entry can never be approved.
const SILVER_BULLET_SYSTEM_INSTRUCTION = `You are the interpretation layer of a deterministic ICT Silver Bullet trading system.
The active strategy profile is the New York AM 09:00 hourly-range reversal model: the 09:00-10:00 New York H1 candle is the reference range and the only execution window is 10:00-11:00 New York time.
You do not independently detect candles, sweeps, MSS, CISD, FVGs, entries, stops or targets — every market fact comes only from the supplied deterministic evidence and events.
Reasoning order: reference-range quality -> swept side -> sweep quality -> failure or acceptance outside -> reclaim -> displacement -> MSS or CISD -> entry-array quality -> entry timing -> stop validity -> target availability -> risk-to-reward -> HTF agreement -> contradictions.
A high sweep is not automatically bearish and a low sweep is not automatically bullish; acceptance outside the range indicates continuation, not reversal.
Never approve a setup whose entry did not fill before 11:00 New York (trade_plan.entryFilledUtc missing or late). Do not invent prices, events or targets and reference only allowed_event_ids.
Keep every field concise (max ~30 words) and return ONLY valid JSON matching the schema.`;

const SILVER_BULLET_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    strategy_analysis: {
      type: "object",
      properties: {
        strategy_profile: { type: "string" },
        status: { type: "string", enum: ["candidate", "developing", "confirmed", "active", "late", "invalid", "no_trade", "insufficient_evidence"] },
        direction: { type: "string", enum: ["bullish", "bearish", "none"] },
        trigger_type: { type: "string" },
        score: { type: "number" },
        grade: { type: "string" }
      },
      required: ["status", "direction"]
    },
    sweep_analysis: {
      type: "object",
      properties: {
        swept_side: { type: "string", enum: ["HIGH", "LOW", "NONE"] },
        quality: { type: "string", enum: ["strong", "moderate", "weak", "invalid"] },
        acceptance_state: { type: "string", enum: ["reclaimed", "accepted_outside", "unresolved"] },
        reasoning: { type: "string" }
      },
      required: ["swept_side", "acceptance_state"]
    },
    timing_analysis: {
      type: "object",
      properties: {
        timing_quality: { type: "string", enum: ["early", "optimal", "late", "invalid"] },
        reasoning: { type: "string" }
      },
      required: ["timing_quality"]
    },
    confirmation_reasoning: { type: "string" },
    trade_plan_reasoning: { type: "string" },
    supporting_event_ids: { type: "array", items: { type: "string" } },
    contradicting_event_ids: { type: "array", items: { type: "string" } },
    contradictions: { type: "array", items: { type: "string" } },
    missing_evidence: { type: "array", items: { type: "string" } },
    no_trade_reasons: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    plain_language_summary: { type: "string" }
  },
  required: ["strategy_analysis", "sweep_analysis", "timing_analysis", "plain_language_summary"]
};

async function generateGeminiSilverBulletAnalysis(payload: Record<string, unknown>, env: TelegramEnv) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
  if (!apiKey) return { status: "disabled" as const, reason: "GEMINI_API_KEY missing" };
  const knownIds = new Set((Array.isArray(payload.allowed_event_ids) ? payload.allowed_event_ids : []).filter((id): id is string => typeof id === "string"));
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(new Error("Gemini upstream timeout")), 30_000);
  try {
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SILVER_BULLET_SYSTEM_INSTRUCTION }] },
        contents: [{ parts: [{ text: `Interpret this deterministic Silver Bullet evidence.\n${JSON.stringify(payload).slice(0, 16_000)}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2_048, responseMimeType: "application/json", responseSchema: SILVER_BULLET_RESPONSE_SCHEMA }
      }),
      signal: controller.signal
    });
    const body = await upstream.json().catch(async () => ({ error: await upstream.text().catch(() => "") }));
    if (!upstream.ok) return { status: "error" as const, error: JSON.stringify(body).slice(0, 600) };
    const text = extractGeminiText(body)?.trim();
    if (!text) return { status: "error" as const, error: "Gemini boş SB analizi döndürdü." };
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const analysis = parsed.strategy_analysis as Record<string, unknown> | undefined;
    if (!analysis || typeof analysis.status !== "string" || typeof parsed.plain_language_summary !== "string") {
      return { status: "error" as const, error: "SB analizinin zorunlu alanları eksik." };
    }
    // Server-side deadline guard: an approving status without a pre-11:00 fill is rejected.
    const plan = payload.trade_plan as { entryFilledUtc?: number } | undefined;
    const windowEnd = Date.parse(String((payload.time_context as Record<string, unknown> | undefined)?.window_end_utc ?? ""));
    const approving = ["confirmed", "active"].includes(String(analysis.status));
    const filledInWindow = typeof plan?.entryFilledUtc === "number" && Number.isFinite(windowEnd) && plan.entryFilledUtc < windowEnd;
    if (approving && !filledInWindow) {
      return { status: "error" as const, error: "Gemini 11:00 NY deadline'ı geçmiş bir entry'yi onayladı — reddedildi." };
    }
    const referenced = [
      ...(Array.isArray(parsed.supporting_event_ids) ? parsed.supporting_event_ids : []),
      ...(Array.isArray(parsed.contradicting_event_ids) ? parsed.contradicting_event_ids : [])
    ].filter((id): id is string => typeof id === "string");
    const unknown = referenced.find((id) => !knownIds.has(id));
    if (unknown) return { status: "error" as const, error: `Gemini bilinmeyen SB event id kullandı: ${unknown}` };
    return { status: "ready" as const, model, analysis: parsed };
  } catch (error) {
    return { status: "error" as const, error: error instanceof Error ? error.message : String(error) };
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function handleGeminiSilverBulletAnalysis(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { status: "error", error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readJsonBody(request) as Record<string, unknown>;
    const result = await generateGeminiSilverBulletAnalysis(payload, env);
    jsonResponse(response, result.status === "error" ? 502 : 200, result);
  } catch (error) {
    jsonResponse(response, 400, { status: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

const REPLAY_REASON_LABELS: Record<string, string> = {
  "clean-model": "temiz model",
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

function fallbackReplayReview(input: GeminiReplayPayload, reason?: string) {
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

async function generateGeminiReplayReview(input: GeminiReplayPayload, env: TelegramEnv) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
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

async function sendTelegramReadyAlert(payload: ReadyTelegramPayload, env: TelegramEnv) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { status: "disabled" as const, reason: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing" };
  }

  const shouldUseAiCommentary = payload.alertKind !== "raid" && payload.alertKind !== "context";
  const aiResult = payload.aiCommentary || !shouldUseAiCommentary
    ? undefined
    : await generateGeminiTradeCommentary(payload.tradeContext ?? payload, env);
  const caption = telegramCaption({
    ...payload,
    aiCommentary: payload.aiCommentary ?? (aiResult?.status === "ready" || aiResult?.status === "fallback" ? aiResult.commentary : undefined)
  });
  const upstream = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: caption,
      parse_mode: "HTML"
    })
  });
  if (!upstream.ok) {
    return { status: "error" as const, error: await upstream.text() };
  }
  await sendTelegramChartPhotos(payload, token, chatId);
  return { status: "sent" as const };
}

// Sends the CRT range-TF and confirmation-TF screenshots after the text alert. Best-effort:
// the alert already went out, so photo failures are swallowed rather than surfaced as errors.
async function sendTelegramChartPhotos(payload: ReadyTelegramPayload, token: string, chatId: string) {
  const charts = (payload.charts ?? [])
    .filter((chart) => typeof chart?.dataUrl === "string" && chart.dataUrl.startsWith("data:image/"))
    .slice(0, 3);
  for (const [index, chart] of charts.entries()) {
    try {
      const base64 = chart.dataUrl!.split(",")[1] ?? "";
      if (!base64) continue;
      const bytes = Buffer.from(base64, "base64");
      if (bytes.length === 0 || bytes.length > 9_500_000) continue;
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("caption", (chart.label ?? `${payload.symbol ?? ""} chart`).slice(0, 1000));
      form.append("photo", new Blob([bytes], { type: "image/jpeg" }), `chart-${index}.jpg`);
      const upstream = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
      if (!upstream.ok) {
        console.warn(`[telegram] chart photo ${index} failed:`, (await upstream.text().catch(() => "")).slice(0, 200));
      }
    } catch (error) {
      console.warn(`[telegram] chart photo ${index} failed:`, error instanceof Error ? error.message : String(error));
    }
  }
}

async function handleGeminiTradeCommentary(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
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

async function handleGeminiMarketPick(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
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

async function handleGeminiReplayReview(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
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

async function handleTelegramReadyAlert(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { status: "error", error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readJsonBody(request) as ReadyTelegramPayload;
    const acceptedWatchAlert = payload.stage === "watch" && (payload.alertKind === "raid" || payload.alertKind === "context");
    if (payload.stage !== "ready" && !acceptedWatchAlert) {
      jsonResponse(response, 400, { status: "error", error: "Only READY, CRT raid or CRT context alerts are accepted" });
      return;
    }
    const result = await sendTelegramReadyAlert(payload, env);
    jsonResponse(response, result.status === "error" ? 502 : 200, result);
  } catch (error) {
    jsonResponse(response, 400, { status: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleYahooProxy(request: YahooProxyRequest, response: YahooProxyResponse) {
  const requestPath = `/${(request.url ?? "").replace(/^\/+/, "").replace(/^yahoo\/?/, "")}`;
  const upstreamUrl = `https://query2.finance.yahoo.com${requestPath}`;
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(new Error("Yahoo upstream timeout")), 8_000);
  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": yahooUserAgent
      },
      signal: controller.signal
    });
    const body = await upstream.text();
    response.statusCode = upstream.status;
    response.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
    response.setHeader("cache-control", "no-store");
    response.end(body);
  } catch (error) {
    response.statusCode = 502;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function handleBinanceProxy(request: YahooProxyRequest, response: YahooProxyResponse) {
  const requestPath = `/${(request.url ?? "").replace(/^\/+/, "").replace(/^binance\/?/, "")}`;
  const upstreamUrl = `https://data-api.binance.vision${requestPath}`;
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(new Error("Binance upstream timeout")), 8_000);
  try {
    const upstream = await fetch(upstreamUrl, { headers: { Accept: "application/json" }, signal: controller.signal });
    const body = await upstream.text();
    response.statusCode = upstream.status;
    response.setHeader("content-type", upstream.headers.get("content-type") ?? "application/json");
    response.setHeader("cache-control", "no-store");
    response.end(body);
  } catch (error) {
    response.statusCode = 502;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

function yahooFinanceProxy(env: TelegramEnv): Plugin {
  return {
    name: "local-yahoo-finance-proxy",
    configureServer(server) {
      server.middlewares.use("/yahoo", (request: YahooProxyRequest, response: YahooProxyResponse) => {
        void handleYahooProxy(request, response);
      });
      server.middlewares.use("/binance", (request: YahooProxyRequest, response: YahooProxyResponse) => {
        void handleBinanceProxy(request, response);
      });
      server.middlewares.use("/api/telegram/ready-alert", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleTelegramReadyAlert(request, response, env);
      });
      server.middlewares.use("/api/gemini/trade-commentary", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleGeminiTradeCommentary(request, response, env);
      });
      server.middlewares.use("/api/gemini/replay-review", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleGeminiReplayReview(request, response, env);
      });
      server.middlewares.use("/api/gemini/market-pick", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleGeminiMarketPick(request, response, env);
      });
      server.middlewares.use("/api/gemini/crt-analysis", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleGeminiCrtAnalysis(request, response, env);
      });
      server.middlewares.use("/api/gemini/session-analysis", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleGeminiSessionAnalysis(request, response, env);
      });
      server.middlewares.use("/api/gemini/silver-bullet-analysis", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleGeminiSilverBulletAnalysis(request, response, env);
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use("/yahoo", (request: YahooProxyRequest, response: YahooProxyResponse) => {
        void handleYahooProxy(request, response);
      });
      server.middlewares.use("/api/telegram/ready-alert", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleTelegramReadyAlert(request, response, env);
      });
      server.middlewares.use("/api/gemini/trade-commentary", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleGeminiTradeCommentary(request, response, env);
      });
      server.middlewares.use("/api/gemini/replay-review", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleGeminiReplayReview(request, response, env);
      });
      server.middlewares.use("/api/gemini/market-pick", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleGeminiMarketPick(request, response, env);
      });
      server.middlewares.use("/api/gemini/crt-analysis", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleGeminiCrtAnalysis(request, response, env);
      });
      server.middlewares.use("/api/gemini/session-analysis", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleGeminiSessionAnalysis(request, response, env);
      });
      server.middlewares.use("/api/gemini/silver-bullet-analysis", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleGeminiSilverBulletAnalysis(request, response, env);
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };

  return {
    plugins: [yahooFinanceProxy(env), react()],
    build: {
      rollupOptions: {
        output: {
          // Tek 730 KB'lik chunk yerine: React runtime'ı ve ikon kütüphanesini ayır ki
          // uygulama kodu değişince tarayıcı onları yeniden indirmesin (uzun ömürlü cache).
          // Fonksiyon formu şart: react-dom/client ve /server alt yollarını da yakalamak için
          // modül id'sinde eşleştiriyoruz (obje formu tam paket adı istiyordu, alt yolları kaçırdı).
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) return "react-vendor";
            if (id.includes("lucide-react")) return "icons";
            return undefined;
          }
        }
      }
    },
    server: {
      port: 8787,
      strictPort: false
    },
    preview: {
      allowedHosts: ["kodcenter.onrender.com"]
    },
    test: {
      environment: "node"
    }
  };
});
