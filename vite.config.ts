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
  grade?: string;
  score?: number;
  stage?: string;
  entry?: number;
  stopLoss?: number;
  targets?: number[];
  rr?: number;
  grossRR?: number;
  reasons?: string[];
  aiCommentary?: string;
  tradeContext?: GeminiTradePayload;
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
    dailyBias?: string;
    h4Bias?: string;
    h1Bias?: string;
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
  const target = payload.targets?.[0];
  const aiCommentary = payload.aiCommentary?.trim()
    ? ["", "<b>AI Yorumu</b>", escapeHtml(payload.aiCommentary.trim())]
    : [];
  return [
    `<b>READY SETUP</b> ${escapeHtml(payload.symbol ?? "-")} ${escapeHtml((payload.direction ?? "").toUpperCase())}`,
    `${escapeHtml(payload.grade ?? "-")} · Score ${payload.score ?? "-"} · Net RR ${formatTelegramR(payload.rr)}`,
    "",
    `Entry: <b>${formatTelegramPrice(payload.entry)}</b>`,
    `Stop: <b>${formatTelegramPrice(payload.stopLoss)}</b>`,
    `TP1: <b>${formatTelegramPrice(target)}</b>`,
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

function fallbackTradeCommentary(input: GeminiTradePayload, reason?: string) {
  const warning = input.warnings?.[0];
  const invalidation = input.invalidation?.[0];
  const plan =
    input.stage === "ready"
      ? "Plan hazır; entry, stop ve TP seviyeleri belli."
      : input.stage === "missed"
        ? "Entry kaçmış veya hedefe gitmiş; kovalamadan yeni setup bekle."
        : input.stage === "invalidated"
          ? "Setup bozulmuş; yeni model bekle."
          : input.entryModel?.status === "confirmed"
            ? "Entry modeli var ama kalite/RR/filtreler için bekle."
            : "Retest ve MSS/CISD kapanış onayı bekle.";
  return {
    status: "fallback" as const,
    commentary: clampText([
      `Chart okuması: ${input.symbol ?? "-"} ${(input.direction ?? "").toUpperCase()} ${(input.stage ?? "").toUpperCase()} · ${input.grade ?? "-"} · ${formatTelegramR(input.rr)}.`,
      `Ana karar: ${input.chart?.decisionLine || plan}`,
      `Dikkat: ${warning || `PD ${input.context?.premiumDiscount ?? "-"}, HTF ${input.context?.dailyBias ?? "-"}/${input.context?.h4Bias ?? "-"}/${input.context?.h1Bias ?? "-"}.`}`,
      `Mentor notu: ${input.chart?.waitingFor?.[0] || plan} Invalidation: ${invalidation || `Stop ${formatTelegramPrice(input.stopLoss)}.`}`
    ].join("\n"), 900),
    model: "local-fallback",
    reason
  };
}

function buildGeminiPrompt(input: GeminiTradePayload) {
  const plannedGap = input.entryModel?.fairValueGap;
  const plannedGapText = plannedGap
    ? `${plannedGap.source ?? "fvg"} ${plannedGap.direction ?? ""} ${plannedGap.low}-${plannedGap.high}, midpoint=${plannedGap.midpoint}, mitigated=${plannedGap.mitigated}`
    : "planlı FVG/iFVG yok; FVG kelimesini kullanma";
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

  return clampText(`
Sen kullanıcının net ve doğrudan konuşan ICT/KOD chart akıl hocasısın.
Bu otomatik emir sistemi değildir; al/sat emri verme, kesinlik konuşma, yatırım tavsiyesi yazma.
Türkçe yaz. Teknik terimleri koru. En fazla 6 kısa satır yaz.
Chartı gerçekten oku: son mum dizilimi, sweep, MSS/CISD, displacement, entry kutusu, stop ve TP mesafesini beraber değerlendir.
Hangi mum/level bekleniyor ise açık söyle. "Şu mumun high/low kapanışı" gibi somut ol.
Eğer EntryModel FVG/iFVG değilse veya FVG alanı yoksa FVG/iFVG yorumu yapma.
Eğer chart verisi plana tersse bunu açıkça eleştir: "bu chartta FVG yok", "entry chase olur", "stop zaten görülmüş" gibi.

Format:
Chart: ...
Karar: ...
Beklenen mum/level: ...
Risk: ...
Mentor notu: ...

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
EntryModel=${input.entryModel?.source}/${input.entryModel?.status}, retest=${input.entryModel?.retested}, MSS/CISD=${input.entryModel?.cisdConfirmed}
PlannedFVG=${plannedGapText}
Bias D/H4/H1=${input.context?.dailyBias}/${input.context?.h4Bias}/${input.context?.h1Bias}
PD=${input.context?.premiumDiscount}
Session=${input.context?.session}
Feed=${input.context?.dataFeed}

ChartRead:
Timeframe=${input.chart?.timeframe}
LastPrice=${input.chart?.lastPrice}
DecisionLine=${input.chart?.decisionLine}

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

async function generateGeminiTradeCommentary(input: GeminiTradePayload, env: TelegramEnv) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-3.5-flash";
  if (!apiKey) {
    return { status: "disabled" as const, reason: "GEMINI_API_KEY missing" };
  }

  const timeouts = [18_000, 10_000];
  let lastError = "";
  for (let attempt = 0; attempt < timeouts.length; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = globalThis.setTimeout(() => controller.abort(new Error("Gemini upstream timeout")), timeouts[attempt]);
    try {
    const upstream = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        model,
        input: buildGeminiPrompt(input)
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
    return { status: "ready" as const, commentary: clampText(commentary, 900), model };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === timeouts.length - 1) return fallbackTradeCommentary(input, lastError);
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }
  return fallbackTradeCommentary(input, lastError || "Gemini yorumu alınamadı.");
}

async function sendTelegramReadyAlert(payload: ReadyTelegramPayload, env: TelegramEnv) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { status: "disabled" as const, reason: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing" };
  }

  const aiResult = payload.aiCommentary
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
  return { status: "sent" as const };
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

async function handleTelegramReadyAlert(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { status: "error", error: "Method not allowed" });
    return;
  }
  try {
    const payload = await readJsonBody(request) as ReadyTelegramPayload;
    if (payload.stage !== "ready") {
      jsonResponse(response, 400, { status: "error", error: "Only ready alerts are accepted" });
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

function yahooFinanceProxy(env: TelegramEnv): Plugin {
  return {
    name: "local-yahoo-finance-proxy",
    configureServer(server) {
      server.middlewares.use("/yahoo", (request: YahooProxyRequest, response: YahooProxyResponse) => {
        void handleYahooProxy(request, response);
      });
      server.middlewares.use("/api/telegram/ready-alert", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleTelegramReadyAlert(request, response, env);
      });
      server.middlewares.use("/api/gemini/trade-commentary", (request: JsonRequest, response: YahooProxyResponse) => {
        void handleGeminiTradeCommentary(request, response, env);
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
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };

  return {
    plugins: [yahooFinanceProxy(env), react()],
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
