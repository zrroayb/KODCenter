// Bildirim mesajı ile gerçek trade içeriği uyuyor mu? Worker'ın telegramCaption mantığını BİREBİR
// kopyalar, canlı veriden CRT + continuation sinyalleri üretir, payload'ı kurar, mesajı render eder
// ve kaynak signal.plan ile karşılaştırır. Canlı worker'a dokunmaz — sadece doğrulama.
import { loadYahooMarketBatch, YAHOO_SYMBOLS } from "../src/lib/data/yahooProvider";
import { buildMarketContext } from "../src/lib/intelligence/marketContext";
import { attachSmtDivergences } from "../src/lib/intelligence/smtEngine";
import { crtStrategy } from "../src/lib/strategies/crt/crt.strategy";
import { trendContinuationStrategy } from "../src/lib/strategies/trendContinuation/trendContinuation.strategy";
import { buildTelegramReadyAlertPayload, type TelegramReadyAlertPayload } from "../src/lib/telegram/alertPayload";
import type { TradingSignal } from "../src/lib/ict/types";

// ── worker/index.ts helper'larının BİREBİR kopyası (formatı sadık tutmak için) ──
function escapeHtml(v: string) { return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function formatPrice(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(5);
}
function formatR(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? `1:${value.toFixed(2)}` : "1:0.00"; }

function telegramCaption(payload: TelegramReadyAlertPayload) {
  const reasons = payload.reasons.slice(0, 6).map((r) => `- ${escapeHtml(r)}`).join("\n");
  const isCrt = (payload.strategyId ?? "crt") === "crt";
  const playbookLine = payload.playbook ? ` · ${escapeHtml(payload.playbook)}` : "";
  const rrLine = isCrt
    ? `${escapeHtml(payload.grade)} · Score ${payload.score} · EQ net RR ${formatR(payload.managementRR ?? 0)} · DOL net RR ${formatR(payload.rr)}`
    : `${escapeHtml(payload.grade)} · Score ${payload.score} · net RR ${formatR(payload.rr)}`;
  const tp1Label = isCrt ? "EQ / TP1" : "TP1";
  const tp2Label = isCrt ? "DOL / TP2" : "TP2";
  const targetLines = [`${tp1Label}: <b>${formatPrice(payload.targets[0])}</b>`];
  if (payload.targets[1] !== undefined && payload.targets[1] !== payload.targets[0]) targetLines.push(`${tp2Label}: <b>${formatPrice(payload.targets[1])}</b>`);
  return [
    `<b>READY SETUP</b> ${escapeHtml(payload.symbol)} ${escapeHtml(payload.direction.toUpperCase())}${playbookLine}`,
    rrLine, "", `Entry: <b>${formatPrice(payload.entry)}</b>`, `Stop: <b>${formatPrice(payload.stopLoss)}</b>`,
    ...targetLines, "", "<b>Neden READY?</b>", reasons || "- Playbook sırası tamam"
  ].join("\n");
}

function checkParity(label: string, signal: TradingSignal) {
  const p = buildTelegramReadyAlertPayload(signal);
  const plan = signal.plan;
  const mismatches: string[] = [];
  if (p.direction !== signal.direction) mismatches.push(`direction ${p.direction} != ${signal.direction}`);
  if (p.entry !== plan.entry) mismatches.push(`entry ${p.entry} != plan ${plan.entry}`);
  if (p.stopLoss !== plan.stopLoss) mismatches.push(`stop ${p.stopLoss} != plan ${plan.stopLoss}`);
  if (p.rr !== plan.rr) mismatches.push(`rr ${p.rr} != plan ${plan.rr}`);
  if (JSON.stringify(p.targets) !== JSON.stringify(plan.targets.slice(0, 2))) mismatches.push(`targets ${JSON.stringify(p.targets)} != ${JSON.stringify(plan.targets.slice(0, 2))}`);
  if (p.strategyId !== signal.strategyId) mismatches.push(`strategyId ${p.strategyId} != ${signal.strategyId}`);
  const msg = telegramCaption(p);
  const isCrt = signal.strategyId === "crt";
  // İçerik doğruluğu kuralları
  if (isCrt && !msg.includes("EQ / TP1")) mismatches.push("CRT mesajında EQ/TP1 etiketi yok");
  if (!isCrt && msg.includes("EQ / TP1")) mismatches.push("continuation mesajında CRT'ye özel EQ/TP1 sızmış");
  if (!isCrt && msg.includes("DOL")) mismatches.push("continuation mesajında DOL (CRT terimi) sızmış");
  if (!isCrt && msg.includes("EQ net RR")) mismatches.push("continuation mesajında EQ net RR (CRT satırı) sızmış");
  if (!msg.includes(formatPrice(plan.entry))) mismatches.push("mesajda entry fiyatı görünmüyor");
  if (!msg.includes(formatPrice(plan.stopLoss))) mismatches.push("mesajda stop fiyatı görünmüyor");
  if (signal.strategyId === "trend-continuation" && plan.targets.length > 1) mismatches.push("continuation tek hedefli olmalı ama >1 target var");

  console.log(`\n===== ${label} (${signal.symbol} ${signal.direction.toUpperCase()} · ${signal.strategyId} · stage=${signal.stage}) =====`);
  console.log(msg);
  console.log("--- parity ---");
  console.log(mismatches.length ? "❌ UYUMSUZLUK:\n  " + mismatches.join("\n  ") : "✅ mesaj ile plan içeriği tam uyumlu");
  return mismatches.length;
}

async function run() {
  const symbols = YAHOO_SYMBOLS.map((s) => s.symbol);
  const markets = [];
  for (let i = 0; i < symbols.length; i += 4) {
    const b = await loadYahooMarketBatch(symbols.slice(i, i + 4), { baseUrl: "https://query2.finance.yahoo.com", fetcher: fetch, retryAttempts: 3 });
    markets.push(...b.markets);
  }
  const ctxs = attachSmtDivergences(markets.map((m) => buildMarketContext(m.symbol, m.timeframes)));

  const crtSignals = ctxs.flatMap((c) => crtStrategy.scan({ context: c, settings: crtStrategy.defaultSettings }).signals);
  const contSignals = ctxs.flatMap((c) => trendContinuationStrategy.scan({ context: c, settings: { ...trendContinuationStrategy.defaultSettings, minimumRR: 0.1 } }).signals);
  const bestCrt = crtSignals.sort((a, b) => b.score - a.score)[0];
  const bestCont = contSignals.sort((a, b) => b.score - a.score)[0];

  let issues = 0;
  if (bestCrt) issues += checkParity("CRT Reversal", bestCrt); else console.log("CRT sinyali bulunamadı.");
  if (bestCont) issues += checkParity("Trend Continuation", bestCont); else console.log("Continuation sinyali bulunamadı.");
  console.log(`\n${issues === 0 ? "✅ TÜMÜ UYUMLU" : `❌ ${issues} sorun`}`);
  if (issues) process.exitCode = 1;
}
run().catch((e) => { console.error(e instanceof Error ? e.stack : String(e)); process.exitCode = 1; });
