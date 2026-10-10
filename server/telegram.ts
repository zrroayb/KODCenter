// Telegram READY / exit alerts: message text, sending, chart photos, dedupe store and history
// (split from server/app.ts). Only the GitHub scanner (SCAN_TOKEN) can trigger a send.
import { createAlertStore, isAuthorizedScan, type AlertStore } from "./alertGate";
import { type YahooProxyResponse, type TelegramEnv, type JsonRequest, jsonResponse, readJsonBody, escapeHtml, formatTelegramPrice, formatTelegramR } from "./http";
import { type GeminiTradePayload, generateGeminiTradeCommentary } from "./gemini";

export type ReadyTelegramPayload = {
  id?: string;
  strategyId?: string;
  extensionRR?: number;
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

export function telegramCaption(payload: ReadyTelegramPayload) {
  const reasons = (payload.reasons ?? []).slice(0, 5).map((reason) => `- ${escapeHtml(reason)}`).join("\n");
  if (payload.alertKind === "exit") {
    return [
      `<b>ÇIKIŞ UYARISI</b> ${escapeHtml(payload.symbol ?? "-")} ${escapeHtml((payload.direction ?? "").toUpperCase())} (${escapeHtml(payload.rangeTf ?? "?")} CRT, açık işlem)`,
      `Entry ${formatTelegramPrice(payload.entry)} · Stop ${formatTelegramPrice(payload.stopLoss)} · DOL ${formatTelegramPrice(payload.targets?.[1] ?? payload.targets?.[0])}`,
      "",
      reasons || "- Ters SMT + ters MSS",
      "",
      "Otomatik işlem yok: çıkış / stop sıkılaştırma kararı senin."
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
    // plan.rr is the EXIT's net RR (CRT: full close at DOL, stop to break-even at EQ).
    `${escapeHtml(payload.grade ?? "-")} · Score ${payload.score ?? "-"} · Net RR ${formatTelegramR(payload.rr)}${(payload.strategyId ?? "crt") === "crt" ? " (çıkış DOL)" : ""}`,
    ...(riskLine ? [riskLine] : []),
    "",
    `Entry: <b>${formatTelegramPrice(payload.entry)}</b>`,
    `Stop: <b>${formatTelegramPrice(payload.stopLoss)}</b>`,
    ...((payload.strategyId ?? "crt") === "crt"
      ? [`EQ (stop → BE): ${formatTelegramPrice(eqTarget)}`, `Çıkış DOL: <b>${formatTelegramPrice(dolTarget)}</b>`]
      : [`TP1: <b>${formatTelegramPrice(eqTarget)}</b>`, ...(dolTarget !== eqTarget ? [`TP2: <b>${formatTelegramPrice(dolTarget)}</b>`] : [])]),
    "",
    "<b>Neden READY?</b>",
    reasons || "- Entry/SL/TP planı aktif",
    ...aiCommentary
  ].join("\n");
}

export async function sendTelegramReadyAlert(payload: ReadyTelegramPayload, env: TelegramEnv) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { status: "disabled" as const, reason: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing" };
  }

  const shouldUseAiCommentary = payload.alertKind !== "exit";
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

export async function sendTelegramChartPhotos(payload: ReadyTelegramPayload, token: string, chatId: string) {
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

export let alertStore: AlertStore | undefined;

export function alertStoreFor(env: TelegramEnv): AlertStore {
  alertStore ??= createAlertStore(env.ALERT_STORE_PATH || ".data/alert-log.json");
  return alertStore;
}

// Single alert engine (2026-09-26): only the authenticated server-side scanner may send.

export async function handleTelegramReadyAlert(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
  if (request.method !== "POST") {
    jsonResponse(response, 405, { status: "error", error: "Method not allowed" });
    return;
  }
  if (!env.SCAN_TOKEN) {
    jsonResponse(response, 503, { status: "disabled", reason: "SCAN_TOKEN missing: alerts are sent only by the server-side scanner" });
    return;
  }
  if (!isAuthorizedScan(request.headers.authorization, env.SCAN_TOKEN)) {
    jsonResponse(response, 401, { status: "error", error: "Unauthorized" });
    return;
  }
  const store = alertStoreFor(env);
  let dedupeKey: string | undefined;
  try {
    const payload = await readJsonBody(request) as ReadyTelegramPayload & { dedupeKey?: string; record?: unknown };
    if (payload.stage !== "ready" && payload.alertKind !== "exit") {
      jsonResponse(response, 400, { status: "error", error: "Only READY and exit-warning alerts are accepted" });
      return;
    }
    dedupeKey = payload.dedupeKey || `payload|${payload.id ?? ""}`;
    if (!store.claim(dedupeKey)) {
      jsonResponse(response, 200, { status: "duplicate", dedupeKey });
      return;
    }
    const { record, ...alert } = payload;
    const result = await sendTelegramReadyAlert(alert, env);
    if (result.status === "sent") store.markSent(dedupeKey, record ?? { dedupeKey, signalId: payload.id, symbol: payload.symbol, sentAt: Date.now() });
    else store.release(dedupeKey);
    jsonResponse(response, result.status === "error" ? 502 : 200, result);
  } catch (error) {
    if (dedupeKey) store.release(dedupeKey);
    jsonResponse(response, 400, { status: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

// Sent-alert history for every device (was per-browser localStorage only).

export function handleLiveAlerts(request: JsonRequest, response: YahooProxyResponse, env: TelegramEnv) {
  if (request.method !== "GET") {
    jsonResponse(response, 405, { status: "error", error: "Method not allowed" });
    return;
  }
  jsonResponse(response, 200, { status: "ok", alerts: alertStoreFor(env).recent() });
}
