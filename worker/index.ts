import {
  CRT_GEMINI_RESPONSE_SCHEMA,
  CRT_GEMINI_SYSTEM_INSTRUCTION
} from "../src/lib/gemini/crtInterpretation";
import { SESSION_GEMINI_RESPONSE_SCHEMA } from "../src/lib/session/sessionAnalysis";
import type { MarketSymbol, TradingSignal } from "../src/lib/ict/types";
import { YAHOO_SYMBOLS } from "../src/lib/data/yahooProvider";
import { type CompactSignal } from "../src/lib/runtime/cloudSnapshot";
import { compareSignalsByDecision } from "../src/lib/runtime/scanRuntime";
import {
  telegramAlertRecordFromPayload,
  type TelegramReadyAlertPayload
} from "../src/lib/telegram/alertPayload";

type CloudflareEnv = {
  ASSETS: Fetcher;
  DB: D1Database;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GEMINI_MODEL?: string;
  SCAN_TOKEN?: string;
};

type StoredMarketRow = {
  symbol: string;
  payload: string;
  loaded_at: number;
};

type StoredScanRow = {
  symbol: string;
  payload: string;
  scanned_at: number;
};

type StoredStateRow = {
  value: string;
};

type StoredAlertRow = {
  payload: string | null;
};

const SESSION_ANALYSIS_SYSTEM_INSTRUCTION = `You are the interpretation layer of a deterministic CRT and trading-session system.
Use only deterministic_events from the payload. Explain HTF draw, reference-session range, sweep or acceptance, reclaim, displacement, LTF confirmation, target and invalidation.
Do not invent levels, candles or event ids. If evidence is incomplete, return developing or insufficient_evidence.
Return only valid JSON matching the supplied schema.`;

const SILVER_BULLET_SYSTEM_INSTRUCTION = `You are the interpretation layer of a deterministic ICT Silver Bullet system (NY AM 09:00 hourly-range reversal; execution window 10:00-11:00 New York).
Use only the supplied deterministic evidence and allowed_event_ids. A high sweep is not automatically bearish; acceptance outside the range is continuation, not reversal.
Never approve a setup whose entry did not fill before 11:00 New York. Do not invent prices, events or targets.
Keep fields concise and return only valid JSON matching the supplied schema.`;

const SILVER_BULLET_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    strategy_analysis: {
      type: "object",
      properties: {
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

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatPrice(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(5);
}

function formatR(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? `1:${value.toFixed(2)}` : "-";
}

async function ensureSchema(env: CloudflareEnv) {
  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS market_snapshots (
        symbol TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        loaded_at INTEGER NOT NULL
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS scan_results (
        symbol TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        scanned_at INTEGER NOT NULL
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS alert_log (
        dedupe_key TEXT PRIMARY KEY,
        signal_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        error TEXT,
        payload TEXT
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS user_rules (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
  ]);
  // Live-forward outcome columns on alert_log (added 2026-07-26). Only ALTER when missing so
  // ensureSchema stays cheap on the hot path.
  const cols = await env.DB.prepare("PRAGMA table_info(alert_log)").all<{ name: string }>();
  const names = new Set(cols.results.map((col) => col.name));
  const adds: D1PreparedStatement[] = [];
  if (!names.has("outcome")) adds.push(env.DB.prepare("ALTER TABLE alert_log ADD COLUMN outcome TEXT"));
  if (!names.has("r_multiple")) adds.push(env.DB.prepare("ALTER TABLE alert_log ADD COLUMN r_multiple REAL"));
  if (!names.has("resolved_at")) adds.push(env.DB.prepare("ALTER TABLE alert_log ADD COLUMN resolved_at INTEGER"));
  if (adds.length) await env.DB.batch(adds);
}

async function readState(env: CloudflareEnv, key: string) {
  const row = await env.DB.prepare("SELECT value FROM app_state WHERE key = ?")
    .bind(key)
    .first<StoredStateRow>();
  return row?.value;
}

async function storeSnapshot(
  env: CloudflareEnv,
  table: "market_snapshots" | "scan_results",
  symbol: MarketSymbol,
  payload: string,
  now: number
) {
  if (table === "market_snapshots") {
    await env.DB.prepare(`
      INSERT INTO market_snapshots (symbol, payload, loaded_at)
      VALUES (?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET payload = excluded.payload, loaded_at = excluded.loaded_at
    `).bind(symbol, payload, now).run();
    return;
  }
  await env.DB.prepare(`
      INSERT INTO scan_results (symbol, payload, scanned_at)
      VALUES (?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET payload = excluded.payload, scanned_at = excluded.scanned_at
  `).bind(symbol, payload, now).run();
}

function extractGeminiText(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const candidates = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates;
  return candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text)
    .filter((text): text is string => typeof text === "string")
    .join("\n")
    .trim() || undefined;
}

async function callGemini(
  env: CloudflareEnv,
  input: {
    prompt: string;
    systemInstruction?: string;
    responseSchema?: unknown;
    maxOutputTokens?: number;
    temperature?: number;
  }
) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
  if (!apiKey) return { status: "disabled" as const, reason: "GEMINI_API_KEY missing" };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error("Gemini upstream timeout")), 25_000);
  try {
    const generationConfig: Record<string, unknown> = {
      temperature: input.temperature ?? 0.35,
      maxOutputTokens: input.maxOutputTokens ?? 900
    };
    if (input.responseSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = input.responseSchema;
    }
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          ...(input.systemInstruction
            ? { systemInstruction: { parts: [{ text: input.systemInstruction }] } }
            : {}),
          contents: [{ parts: [{ text: input.prompt }] }],
          generationConfig
        }),
        signal: controller.signal
      }
    );
    const body = await response.json().catch(async () => ({ error: await response.text().catch(() => "") }));
    if (!response.ok) {
      return { status: "error" as const, error: JSON.stringify(body).slice(0, 800) };
    }
    const text = extractGeminiText(body);
    if (!text) return { status: "error" as const, error: "Gemini boş yanıt döndürdü." };
    return { status: "ready" as const, text, model };
  } catch (error) {
    return { status: "error" as const, error: errorMessage(error) };
  } finally {
    clearTimeout(timeoutId);
  }
}

function tradePrompt(payload: unknown) {
  return `Sen deneyimli bir CRT mentorusun. Yalnızca verilen deterministik setup verisini yorumla.
Türkçe, kısa ve net yaz. Yatırım tavsiyesi veya kesinlik verme.
Tam dört satır kullan:
Karar: ...
Neden: ...
Beklenen: ...
Risk: ...
Veri:
${JSON.stringify(payload).slice(0, 15_000)}`;
}

function replayPrompt(payload: unknown) {
  return `Sen kıdemli bir CRT strateji kalibrasyon analistisin.
Replay verisine göre overfit yapmadan kısa bir değerlendirme yaz.
WATCH-promoted ile live READY'yi ayır. Kötü sonucu açıkça söyle.
Hard guardrail: Toplam tetiklenen trade 20'nin altındaysa hiçbir kural değişikliği, sembol durdurma veya setup kapatma önerme; yalnızca "örneklem yetersiz" de.
Bir sembol/setup/filtre hakkında hüküm vermek için o bucket'ta en az 8 tetiklenen trade olmalı.
NOT-TRIGGERED kayıtları performans örneklemine dahil etme. Pozitif sonuç etiketi (EQ/TP) giriş filtresi gibi yorumlanamaz.
Format:
Karar: ...
Ana problem: ...
Kural değişikliği: ...
Sonraki ölçüm: ...
Veri:
${JSON.stringify(payload).slice(0, 16_000)}`;
}

function marketPickPrompt(payload: unknown) {
  return `Sen bir prop firmada CRT masa şefisin. Verilen adaylardan tek bir tercih yap veya hiçbirini alma.
Türkçe 3-5 kısa cümle yaz ve "Masa görüşü:" ile başla.
READY değilse hangi somut onayın beklendiğini söyle. Demo veride gerçek karar verme.
Adaylar:
${JSON.stringify(payload).slice(0, 14_000)}`;
}

function telegramCaption(payload: TelegramReadyAlertPayload) {
  const reasons = payload.reasons.slice(0, 6).map((reason) => `- ${escapeHtml(reason)}`).join("\n");
  const ai = payload.aiCommentary?.trim()
    ? `\n\n<b>AI Yorumu</b>\n${escapeHtml(payload.aiCommentary.trim())}`
    : "";
  const isCrt = (payload.strategyId ?? "crt") === "crt";
  // Playbook etiketi mesajın ilk satırında — reversal mi continuation mı hemen belli olsun.
  const playbookLine = payload.playbook ? ` · ${escapeHtml(payload.playbook)}` : "";
  // EQ/DOL sadece CRT reversal terimleri; continuation için TP1/TP2 ve düz net RR kullanılır.
  const rrLine = isCrt
    ? `${escapeHtml(payload.grade)} · Score ${payload.score} · EQ net RR ${formatR(payload.managementRR ?? 0)} · DOL net RR ${formatR(payload.rr)}`
    : `${escapeHtml(payload.grade)} · Score ${payload.score} · net RR ${formatR(payload.rr)}`;
  const tp1Label = isCrt ? "EQ / TP1" : "TP1";
  const tp2Label = isCrt ? "DOL / TP2" : "TP2";
  const targetLines = [`${tp1Label}: <b>${formatPrice(payload.targets[0])}</b>`];
  if (payload.targets[1] !== undefined && payload.targets[1] !== payload.targets[0]) {
    targetLines.push(`${tp2Label}: <b>${formatPrice(payload.targets[1])}</b>`);
  }
  return [
    `<b>READY SETUP</b> ${escapeHtml(payload.symbol)} ${escapeHtml(payload.direction.toUpperCase())}${playbookLine}`,
    rrLine,
    "",
    `Entry: <b>${formatPrice(payload.entry)}</b>`,
    `Stop: <b>${formatPrice(payload.stopLoss)}</b>`,
    ...targetLines,
    "",
    "<b>Neden READY?</b>",
    reasons || "- Playbook sırası tamam"
  ].join("\n") + ai;
}

async function claimAlert(env: CloudflareEnv, payload: TelegramReadyAlertPayload) {
  const now = Date.now();
  const dedupeKey = payload.dedupeKey || `payload|${payload.id}`;
  const alertRecord = telegramAlertRecordFromPayload({ ...payload, dedupeKey }, now);
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO alert_log (dedupe_key, signal_id, status, created_at, updated_at, payload)
    VALUES (?, ?, 'pending', ?, ?, ?)
  `).bind(dedupeKey, payload.id, now, now, JSON.stringify(alertRecord)).run();
  return {
    claimed: Number(result.meta.changes ?? 0) > 0,
    dedupeKey
  };
}

async function liveAlertsResponse(env: CloudflareEnv) {
  await ensureSchema(env);
  const rows = await env.DB.prepare(`
    SELECT payload FROM alert_log
    WHERE status = 'sent' AND created_at >= ? AND payload IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 30
  `).bind(Date.now() - 24 * 60 * 60 * 1000).all<StoredAlertRow>();
  const alerts = rows.results.flatMap((row) => {
    if (!row.payload) return [];
    try {
      return [JSON.parse(row.payload)];
    } catch {
      return [];
    }
  });
  return jsonResponse({ status: "ok", alerts });
}

async function sendTelegramAlert(env: CloudflareEnv, payload: TelegramReadyAlertPayload) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { status: "disabled" as const, reason: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing" };
  }

  const claim = await claimAlert(env, payload);
  if (!claim.claimed) return { status: "disabled" as const, reason: "duplicate" };

  try {
    let aiCommentary = payload.aiCommentary;
    if (!aiCommentary && payload.tradeContext) {
      const ai = await callGemini(env, {
        prompt: tradePrompt(payload.tradeContext),
        maxOutputTokens: 600,
        temperature: 0.45
      });
      if (ai.status === "ready") aiCommentary = ai.text;
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: telegramCaption({ ...payload, aiCommentary }),
        parse_mode: "HTML"
      })
    });
    if (!response.ok) throw new Error((await response.text()).slice(0, 800));
    await env.DB.prepare(`
      UPDATE alert_log SET status = 'sent', updated_at = ?, error = NULL WHERE dedupe_key = ?
    `).bind(Date.now(), claim.dedupeKey).run();
    return { status: "sent" as const };
  } catch (error) {
    await env.DB.prepare("DELETE FROM alert_log WHERE dedupe_key = ?")
      .bind(claim.dedupeKey)
      .run();
    return { status: "error" as const, error: errorMessage(error) };
  }
}

async function liveMarketsResponse(env: CloudflareEnv) {
  await ensureSchema(env);
  const rows = await env.DB.prepare(`
    SELECT symbol, payload, loaded_at FROM market_snapshots ORDER BY symbol
  `).all<StoredMarketRow>();
  if (rows.results.length < YAHOO_SYMBOLS.length) {
    return jsonResponse({
      status: "warming",
      marketCount: rows.results.length,
      requiredMarketCount: YAHOO_SYMBOLS.length
    }, 503);
  }
  const loadedAt = Math.max(...rows.results.map((row) => row.loaded_at));
  const oldestLoadedAt = Math.min(...rows.results.map((row) => row.loaded_at));
  const errors = JSON.parse((await readState(env, "last_errors")) || "[]") as string[];
  const body = `{"markets":[${rows.results.map((row) => row.payload).join(",")}],"loadedAt":${loadedAt},"oldestLoadedAt":${oldestLoadedAt},"background":true,"errors":${JSON.stringify(errors)}}`;
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=20"
    }
  });
}

async function liveScanResponse(env: CloudflareEnv) {
  await ensureSchema(env);
  const rows = await env.DB.prepare(`
    SELECT symbol, payload, scanned_at FROM scan_results ORDER BY symbol
  `).all<StoredScanRow>();
  const merged = {
    signals: [] as CompactSignal[],
    hiddenSignals: [] as CompactSignal[],
    inactiveSignals: [] as CompactSignal[],
    rejected: [] as unknown[]
  };
  rows.results.forEach((row) => {
    const parsed = JSON.parse(row.payload) as typeof merged;
    merged.signals.push(...(parsed.signals ?? []));
    merged.hiddenSignals.push(...(parsed.hiddenSignals ?? []));
    merged.inactiveSignals.push(...(parsed.inactiveSignals ?? []));
    merged.rejected.push(...(parsed.rejected ?? []));
  });
  merged.signals.sort((a, b) => compareSignalsByDecision(a as TradingSignal, b as TradingSignal));
  merged.hiddenSignals.sort((a, b) => compareSignalsByDecision(a as TradingSignal, b as TradingSignal));
  return jsonResponse({
    status: rows.results.length === YAHOO_SYMBOLS.length ? "ready" : "warming",
    generatedAt: rows.results.length ? Math.max(...rows.results.map((row) => row.scanned_at)) : 0,
    marketCount: rows.results.length,
    ...merged
  });
}

async function handleGeminiEndpoint(request: Request, env: CloudflareEnv, pathname: string) {
  if (request.method !== "POST") return jsonResponse({ status: "error", error: "Method not allowed" }, 405);
  const payload = await request.json().catch(() => null);
  if (!payload) return jsonResponse({ status: "error", error: "Geçersiz JSON" }, 400);

  if (pathname === "/api/gemini/crt-analysis") {
    const result = await callGemini(env, {
      prompt: `Interpret this deterministic CRT evidence. Reference only supplied event ids.\n${JSON.stringify(payload).slice(0, 16_000)}`,
      systemInstruction: CRT_GEMINI_SYSTEM_INSTRUCTION,
      responseSchema: CRT_GEMINI_RESPONSE_SCHEMA,
      maxOutputTokens: 3_000,
      temperature: 0.25
    });
    if (result.status !== "ready") return jsonResponse(result, result.status === "error" ? 502 : 200);
    try {
      return jsonResponse({ status: "ready", analysis: JSON.parse(result.text), model: result.model });
    } catch {
      return jsonResponse({ status: "error", error: "Gemini geçerli CRT JSON döndürmedi." }, 502);
    }
  }

  if (pathname === "/api/gemini/session-analysis") {
    const result = await callGemini(env, {
      prompt: `Explain this deterministic CRT session setup.\n${JSON.stringify(payload).slice(0, 16_000)}`,
      systemInstruction: SESSION_ANALYSIS_SYSTEM_INSTRUCTION,
      responseSchema: SESSION_GEMINI_RESPONSE_SCHEMA,
      maxOutputTokens: 2_000,
      temperature: 0.2
    });
    if (result.status !== "ready") return jsonResponse(result, result.status === "error" ? 502 : 200);
    try {
      return jsonResponse({ status: "ready", analysis: JSON.parse(result.text), model: result.model });
    } catch {
      return jsonResponse({ status: "error", error: "Gemini geçerli session JSON döndürmedi." }, 502);
    }
  }

  if (pathname === "/api/gemini/silver-bullet-analysis") {
    const result = await callGemini(env, {
      prompt: `Interpret this deterministic Silver Bullet evidence.\n${JSON.stringify(payload).slice(0, 16_000)}`,
      systemInstruction: SILVER_BULLET_SYSTEM_INSTRUCTION,
      responseSchema: SILVER_BULLET_RESPONSE_SCHEMA,
      maxOutputTokens: 2_000,
      temperature: 0.2
    });
    if (result.status !== "ready") return jsonResponse(result, result.status === "error" ? 502 : 200);
    try {
      const parsed = JSON.parse(result.text) as { strategy_analysis?: { status?: string } };
      // Deadline guard mirrors the vite handler: approving without a pre-11:00 fill is rejected.
      const plan = (payload as { trade_plan?: { entryFilledUtc?: number } }).trade_plan;
      const windowEnd = Date.parse(String((payload as { time_context?: { window_end_utc?: string } }).time_context?.window_end_utc ?? ""));
      const approving = ["confirmed", "active"].includes(String(parsed.strategy_analysis?.status));
      const filledInWindow = typeof plan?.entryFilledUtc === "number" && Number.isFinite(windowEnd) && plan.entryFilledUtc < windowEnd;
      if (approving && !filledInWindow) {
        return jsonResponse({ status: "error", error: "Gemini 11:00 NY deadline'ı geçmiş bir entry'yi onayladı — reddedildi." }, 502);
      }
      return jsonResponse({ status: "ready", analysis: parsed, model: result.model });
    } catch {
      return jsonResponse({ status: "error", error: "Gemini geçerli SB JSON döndürmedi." }, 502);
    }
  }

  const prompt = pathname === "/api/gemini/replay-review"
    ? replayPrompt(payload)
    : pathname === "/api/gemini/market-pick"
      ? marketPickPrompt(payload)
      : tradePrompt(payload);
  const result = await callGemini(env, { prompt, maxOutputTokens: 900, temperature: 0.45 });
  if (result.status !== "ready") return jsonResponse(result, result.status === "error" ? 502 : 200);
  return jsonResponse({ status: "ready", commentary: result.text, model: result.model });
}

async function handleYahooProxy(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/yahoo/, "");
  if (!path.startsWith("/v8/finance/chart/")) {
    return jsonResponse({ error: "Unsupported Yahoo route" }, 404);
  }
  const upstreamUrl = new URL(`https://query2.finance.yahoo.com${path}`);
  upstreamUrl.search = url.search;
  const response = await fetch(upstreamUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0"
    },
    cf: { cacheTtl: 30, cacheEverything: true }
  });
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
      "cache-control": "public, max-age=20"
    }
  });
}

function hasScanAccess(request: Request, env: CloudflareEnv) {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(env.SCAN_TOKEN && supplied === env.SCAN_TOKEN);
}

function isMarketSymbol(value: unknown): value is MarketSymbol {
  return typeof value === "string" && YAHOO_SYMBOLS.some((item) => item.symbol === value);
}

async function handleMarketIngest(request: Request, env: CloudflareEnv) {
  if (request.method !== "POST") return jsonResponse({ status: "error", error: "Method not allowed" }, 405);
  if (!hasScanAccess(request, env)) return jsonResponse({ status: "error", error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const scannedAt = Number(url.searchParams.get("scannedAt"));
  if (!isMarketSymbol(symbol) || !Number.isFinite(scannedAt)) {
    return jsonResponse({ status: "error", error: "Invalid snapshot metadata" }, 400);
  }
  const payload = await request.text();
  if (!payload.startsWith("{") || payload.length > 2_000_000) {
    return jsonResponse({ status: "error", error: "Invalid snapshot payload" }, 400);
  }

  await storeSnapshot(env, "market_snapshots", symbol, payload, scannedAt);
  return jsonResponse({ status: "stored", symbol });
}

async function handleScanIngest(request: Request, env: CloudflareEnv) {
  if (request.method !== "POST") return jsonResponse({ status: "error", error: "Method not allowed" }, 405);
  if (!hasScanAccess(request, env)) return jsonResponse({ status: "error", error: "Unauthorized" }, 401);

  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol");
  const scannedAt = Number(url.searchParams.get("scannedAt"));
  if (!isMarketSymbol(symbol) || !Number.isFinite(scannedAt)) {
    return jsonResponse({ status: "error", error: "Invalid snapshot metadata" }, 400);
  }
  const payload = await request.text();
  if (!payload.startsWith("{") || payload.length > 1_000_000) {
    return jsonResponse({ status: "error", error: "Invalid snapshot payload" }, 400);
  }

  await storeSnapshot(env, "scan_results", symbol, payload, scannedAt);
  return jsonResponse({ status: "stored", symbol });
}

// ── Live-forward outcome logging ────────────────────────────────────────────
// Her READY alert'i alert_log'da planıyla saklanır. Her tarama sonunda, henüz çözülmemiş
// alertler o an D1'deki taze m15 snapshot mumlarına karşı değerlendirilir: entry sonrası önce
// stop mu yoksa ilk hedef (EQ/TP1) mi görüldü. Bu, replay'in ölçtüğü şeyin CANLI karşılığı —
// playbook edge'inin gerçek dünyada tutup tutmadığını biriktirir. Cloud-scan cadence'ine bağlıdır.
type ResolverCandle = { time: number; high: number; low: number; close: number };
type AlertRecord = {
  symbol?: string; direction?: string; strategyId?: string; alertKind?: string;
  createdAt?: number; entry?: number; stopLoss?: number; targets?: number[];
};

// Muhafazakâr sonuç: entry sonrası mumlarda aynı mumda hem stop hem hedef varsa stop önce sayılır
// (replay ile aynı konvansiyon). Hedef = ilk target (CRT eq-full ve continuation tek-hedef).
function resolveAlertOutcome(rec: AlertRecord, candles: ResolverCandle[]): { outcome: string; r: number; resolvedAt: number } | null {
  const entry = rec.entry, stop = rec.stopLoss, target = rec.targets?.[0], created = rec.createdAt;
  const dir = rec.direction;
  if (![entry, stop, target, created].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (dir !== "long" && dir !== "short") return null;
  const risk = Math.abs((entry as number) - (stop as number));
  if (risk <= 0) return null;
  const MAX_HOLD_MS = 96 * 15 * 60 * 1000; // replay maxHold 96 m15 ≈ 1 gün
  const after = candles.filter((c) => c.time > (created as number)).sort((a, b) => a.time - b.time);
  for (const c of after) {
    const stopHit = dir === "long" ? c.low <= (stop as number) : c.high >= (stop as number);
    const targetHit = dir === "long" ? c.high >= (target as number) : c.low <= (target as number);
    if (stopHit) return { outcome: "loss", r: -1, resolvedAt: c.time };
    if (targetHit) return { outcome: "win", r: Number((Math.abs((target as number) - (entry as number)) / risk).toFixed(2)), resolvedAt: c.time };
    if (c.time - (created as number) > MAX_HOLD_MS) {
      const raw = dir === "long" ? (c.close - (entry as number)) / risk : ((entry as number) - c.close) / risk;
      return { outcome: "expired", r: Number(Math.max(-1, raw).toFixed(2)), resolvedAt: c.time };
    }
  }
  return null; // hâlâ açık
}

async function resolveOpenAlerts(env: CloudflareEnv, nowRef: number) {
  const cutoff = nowRef - 14 * 24 * 60 * 60 * 1000;
  const rows = await env.DB.prepare(`
    SELECT dedupe_key, payload, created_at FROM alert_log
    WHERE status = 'sent' AND resolved_at IS NULL AND created_at >= ? AND payload IS NOT NULL
  `).bind(cutoff).all<{ dedupe_key: string; payload: string; created_at: number }>();
  if (!rows.results.length) return 0;

  const snaps = await env.DB.prepare("SELECT symbol, payload FROM market_snapshots").all<{ symbol: string; payload: string }>();
  const candlesBySymbol = new Map<string, ResolverCandle[]>();
  for (const snap of snaps.results) {
    try {
      const market = JSON.parse(snap.payload) as { timeframes?: { m15?: ResolverCandle[] } };
      candlesBySymbol.set(snap.symbol, market.timeframes?.m15 ?? []);
    } catch { /* skip unparseable snapshot */ }
  }

  const updates: D1PreparedStatement[] = [];
  for (const row of rows.results) {
    let rec: AlertRecord;
    try { rec = JSON.parse(row.payload) as AlertRecord; } catch { continue; }
    if (rec.alertKind && rec.alertKind !== "ready") continue; // sadece gerçek READY girişleri
    const outcome = resolveAlertOutcome(rec, candlesBySymbol.get(rec.symbol ?? "") ?? []);
    if (!outcome) continue;
    updates.push(env.DB.prepare(
      "UPDATE alert_log SET outcome = ?, r_multiple = ?, resolved_at = ?, updated_at = ? WHERE dedupe_key = ?"
    ).bind(outcome.outcome, outcome.r, outcome.resolvedAt, nowRef, row.dedupe_key));
  }
  if (updates.length) await env.DB.batch(updates);
  return updates.length;
}

function edgeMetrics(rs: number[]) {
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const totalR = rs.reduce((s, r) => s + r, 0);
  const grossWin = wins.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r, 0));
  return {
    trades: rs.length,
    totalR: Number(totalR.toFixed(2)),
    expectancyR: rs.length ? Number((totalR / rs.length).toFixed(2)) : 0,
    winRatePct: rs.length ? Number(((wins.length / rs.length) * 100).toFixed(1)) : 0,
    profitFactor: Number((grossLoss ? grossWin / grossLoss : grossWin).toFixed(2))
  };
}

async function edgeReportResponse(env: CloudflareEnv, url: URL) {
  await ensureSchema(env);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? "7")));
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = await env.DB.prepare(`
    SELECT payload, r_multiple FROM alert_log
    WHERE resolved_at IS NOT NULL AND resolved_at >= ? AND outcome IS NOT NULL AND r_multiple IS NOT NULL
  `).bind(cutoff).all<{ payload: string; r_multiple: number }>();
  const byPlaybook = new Map<string, number[]>();
  for (const row of rows.results) {
    let rec: AlertRecord;
    try { rec = JSON.parse(row.payload) as AlertRecord; } catch { continue; }
    const key = rec.strategyId ?? "crt";
    (byPlaybook.get(key) ?? byPlaybook.set(key, []).get(key)!).push(row.r_multiple);
  }
  const playbooks = Array.from(byPlaybook.entries()).map(([strategyId, rs]) => ({ strategyId, ...edgeMetrics(rs) }));
  return jsonResponse({ status: "ok", days, generatedAt: Date.now(), playbooks });
}

async function handleScanFinalize(request: Request, env: CloudflareEnv) {
  if (request.method !== "POST") return jsonResponse({ status: "error", error: "Method not allowed" }, 405);
  if (!hasScanAccess(request, env)) return jsonResponse({ status: "error", error: "Unauthorized" }, 401);

  const payload = await request.json().catch(() => null) as {
    scannedAt?: number;
    symbols?: unknown[];
    errors?: unknown[];
    alerts?: TelegramReadyAlertPayload[];
  } | null;
  if (!payload || !Number.isFinite(payload.scannedAt) || !Array.isArray(payload.symbols)) {
    return jsonResponse({ status: "error", error: "Invalid scan summary" }, 400);
  }

  const now = payload.scannedAt as number;
  const symbols = payload.symbols.filter(isMarketSymbol);
  const errors = Array.isArray(payload.errors)
    ? payload.errors.filter((item): item is string => typeof item === "string")
    : [];
  const alerts = Array.isArray(payload.alerts)
    ? payload.alerts.filter((alert) => alert?.stage === "ready")
    : [];

  const alertResults = await Promise.all(alerts.map((alert) => sendTelegramAlert(env, alert)));
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO app_state (key, value, updated_at) VALUES ('last_scan_at', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(String(now), now),
    env.DB.prepare(`
      INSERT INTO app_state (key, value, updated_at) VALUES ('last_symbols', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(JSON.stringify(symbols), now),
    env.DB.prepare(`
      INSERT INTO app_state (key, value, updated_at) VALUES ('last_errors', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(JSON.stringify(errors), now),
    env.DB.prepare(`
      INSERT INTO app_state (key, value, updated_at) VALUES ('last_scan_error', '', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).bind(now),
    env.DB.prepare("DELETE FROM alert_log WHERE created_at < ?")
      .bind(now - 30 * 24 * 60 * 60 * 1000)
  ]);

  // Live-forward: taze snapshot mumlarına karşı açık READY alertlerini çöz (win/loss/expired + R).
  // Best-effort — çözümleme hatası tarama finalizasyonunu bozmamalı.
  let resolved = 0;
  try { resolved = await resolveOpenAlerts(env, now); } catch { /* resolution best-effort */ }

  return jsonResponse({
    status: "finalized",
    scannedAt: now,
    markets: symbols.length,
    alerts: alertResults,
    resolvedOutcomes: resolved
  });
}

// Site → D1 kural aynası. POST bilinçli olarak token'sız: sayfa aynı origin'den, elinde scan
// token'ı olmadan yazar (token'ı tarayıcıya gömmek daha büyük risk). Ham JSON saklanır; asıl
// sanitize her okuyucuda resolveStoredRules ile yapılır. GET yalnız bot içindir (token).
async function handleUserRules(request: Request, env: CloudflareEnv) {
  await ensureSchema(env);
  if (request.method === "POST") {
    const payload = await request.text();
    if (!payload.startsWith("{") || payload.length > 8_192) {
      return jsonResponse({ status: "error", error: "Invalid rules payload" }, 400);
    }
    try {
      JSON.parse(payload);
    } catch {
      return jsonResponse({ status: "error", error: "Invalid rules payload" }, 400);
    }
    const now = Date.now();
    await env.DB.prepare(`
      INSERT INTO user_rules (id, payload, updated_at) VALUES ('default', ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).bind(payload, now).run();
    return jsonResponse({ status: "stored", updatedAt: now });
  }
  if (request.method === "GET") {
    if (!hasScanAccess(request, env)) return jsonResponse({ status: "error", error: "Unauthorized" }, 401);
    const row = await env.DB.prepare("SELECT payload, updated_at FROM user_rules WHERE id = 'default'")
      .first<{ payload: string; updated_at: number }>();
    if (!row) return jsonResponse({ status: "empty", rules: null });
    try {
      return jsonResponse({ status: "ok", rules: JSON.parse(row.payload), updatedAt: row.updated_at });
    } catch {
      return jsonResponse({ status: "empty", rules: null });
    }
  }
  return jsonResponse({ status: "error", error: "Method not allowed" }, 405);
}

async function handleRequest(request: Request, env: CloudflareEnv) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/yahoo/")) return handleYahooProxy(request);
  if (url.pathname === "/api/health") {
    return jsonResponse({
      status: "ok",
      platform: "cloudflare-workers",
      backgroundScan: true,
      scheduler: "github-actions",
      intervalMinutes: 5
    });
  }
  if (url.pathname === "/api/live-markets") return liveMarketsResponse(env);
  if (url.pathname === "/api/live-scan") return liveScanResponse(env);
  if (url.pathname === "/api/live-alerts") return liveAlertsResponse(env);
  // Live-forward edge raporu (public, salt-okunur): çözülmüş READY sonuçları playbook bazında.
  if (url.pathname === "/api/edge-report") return edgeReportResponse(env, url);
  if (url.pathname === "/api/ingest-market") return handleMarketIngest(request, env);
  if (url.pathname === "/api/ingest-scan") return handleScanIngest(request, env);
  if (url.pathname === "/api/finalize-scan") return handleScanFinalize(request, env);
  if (url.pathname === "/api/rules") return handleUserRules(request, env);
  if (url.pathname === "/api/telegram/ready-alert") {
    if (request.method !== "POST") return jsonResponse({ status: "error", error: "Method not allowed" }, 405);
    if (!hasScanAccess(request, env)) return jsonResponse({ status: "error", error: "Unauthorized" }, 401);
    const payload = await request.json().catch(() => null) as TelegramReadyAlertPayload | null;
    if (!payload || (payload.stage !== "ready" && payload.alertKind !== "raid" && payload.alertKind !== "context")) {
      return jsonResponse({ status: "error", error: "Unsupported alert payload" }, 400);
    }
    const result = await sendTelegramAlert(env, payload);
    return jsonResponse(result, result.status === "error" ? 502 : 200);
  }
  if (url.pathname.startsWith("/api/gemini/")) {
    return handleGeminiEndpoint(request, env, url.pathname);
  }
  return env.ASSETS.fetch(request);
}

export default {
  fetch(request: Request, env: CloudflareEnv) {
    return handleRequest(request, env).catch((error) =>
      jsonResponse({ status: "error", error: errorMessage(error) }, 500)
    );
  }
} satisfies ExportedHandler<CloudflareEnv>;
