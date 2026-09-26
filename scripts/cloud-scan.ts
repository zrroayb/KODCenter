// Single Telegram alert engine (2026-09-26): this scanner runs the CURRENT engine in GitHub
// Actions and posts each READY payload to the live site (Render) at
// `${CLOUD_SCAN_URL}/api/telegram/ready-alert` with the SCAN_TOKEN bearer. The server dedupes
// and sends; the browser never sends alerts. The Cloudflare Worker is no longer in this path.
import { loadYahooMarketBatch, YAHOO_SYMBOLS } from "../src/lib/data/yahooProvider";
import { buildMarketContext } from "../src/lib/intelligence/marketContext";
import { attachSmtDivergences } from "../src/lib/intelligence/smtEngine";
import { alertableReadySignals, scanContexts } from "../src/lib/runtime/scanRuntime";
import { buildTelegramReadyAlertPayload, telegramAlertRecordFromPayload } from "../src/lib/telegram/alertPayload";
import { signalAlertChartSvg } from "../src/lib/telegram/alertChartSvg";
import { Resvg } from "@resvg/resvg-js";
import type { TradingSignal } from "../src/lib/ict/types";
import { defaultRules } from "../src/lib/userRules/defaultRules";

const cloudUrl = process.env.CLOUD_SCAN_URL?.replace(/\/+$/, "");
const scanToken = process.env.SCAN_TOKEN;

if (!cloudUrl) throw new Error("CLOUD_SCAN_URL missing (live site base URL, e.g. the Render URL)");
if (!scanToken) throw new Error("SCAN_TOKEN missing");

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function postAlert(signal: TradingSignal): Promise<{ symbol: string; status: string; httpStatus: number }> {
  const payload = buildTelegramReadyAlertPayload(signal);
  const chart = alertChartFor(signal);
  const body = {
    ...payload,
    ...(chart ? { charts: [chart] } : {}),
    // The server stores this record as the shared alert history (/api/live-alerts).
    record: telegramAlertRecordFromPayload({ ...payload, rangeTf: signal.crtAnchor?.rangeTf, confirmTf: signal.crtAnchor?.confirmTf })
  };
  const response = await fetch(`${cloudUrl}/api/telegram/ready-alert`, {
    method: "POST",
    headers: { authorization: `Bearer ${scanToken}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({})) as { status?: string };
  return { symbol: signal.symbol, status: result.status ?? "unknown", httpStatus: response.status };
}

async function run() {
  const scannedAt = Date.now();
  const markets = [];
  const errors: string[] = [];
  const symbols = YAHOO_SYMBOLS.map((item) => item.symbol);

  // Yahoo is more stable with small sequential batches than with 48 parallel requests.
  for (const group of chunks(symbols, 4)) {
    const batch = await loadYahooMarketBatch(group, {
      baseUrl: "https://query2.finance.yahoo.com",
      fetcher: fetch,
      retryAttempts: 3
    });
    markets.push(...batch.markets);
    errors.push(...batch.errors);
  }

  if (!markets.length) {
    throw new Error(errors.join(" | ") || "Yahoo returned no markets");
  }

  const contexts = attachSmtDivergences(
    markets.map((market) => buildMarketContext(market.symbol, market.timeframes))
  );
  // Default rules: the live site has no server-side rules store (the old Worker D1 mirror is
  // out of the alert path). Change defaultRules to change what the scanner alerts on.
  const result = scanContexts(contexts, "crt", defaultRules);
  const readySignals = alertableReadySignals(result);
  const alerts = [];
  for (const signal of readySignals) alerts.push(await postAlert(signal));
  const failed = alerts.filter((alert) => alert.httpStatus >= 400);

  console.log(JSON.stringify({
    status: failed.length ? "partial" : "ok",
    scannedAt,
    markets: markets.length,
    ready: readySignals.length,
    watch: result.signals.filter((signal) => signal.stage === "watch").length,
    errors,
    alerts
  }));
  if (failed.length) process.exitCode = 1;
}

// Ready sinyal icin chart gorseli: bagimsiz SVG -> resvg ile PNG data URL.
// Sunucu bunu payload.charts'tan Telegram'a foto olarak gonderir.
function alertChartFor(signal: TradingSignal): { label: string; dataUrl: string } | undefined {
  const rendered = signalAlertChartSvg(signal);
  if (!rendered) return undefined;
  try {
    const png = new Resvg(rendered.svg, { background: "#0f131c", fitTo: { mode: "width", value: 1120 } }).render().asPng();
    return { label: rendered.label, dataUrl: `data:image/png;base64,${Buffer.from(png).toString("base64")}` };
  } catch {
    return undefined;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
