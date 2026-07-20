import { loadYahooMarketBatch, YAHOO_SYMBOLS } from "../src/lib/data/yahooProvider";
import { buildMarketContext } from "../src/lib/intelligence/marketContext";
import { attachSmtDivergences } from "../src/lib/intelligence/smtEngine";
import type { MarketSymbol } from "../src/lib/ict/types";
import {
  leanMarketForStorage,
  scanSnapshotForSymbol
} from "../src/lib/runtime/cloudSnapshot";
import { alertableReadySignals, scanContexts } from "../src/lib/runtime/scanRuntime";
import { buildTelegramReadyAlertPayload } from "../src/lib/telegram/alertPayload";
import { defaultRules } from "../src/lib/userRules/defaultRules";
import { resolveStoredRules } from "../src/lib/userRules/resolveRules";

const cloudUrl = process.env.CLOUD_SCAN_URL?.replace(/\/+$/, "");
const scanToken = process.env.SCAN_TOKEN;

if (!cloudUrl) throw new Error("CLOUD_SCAN_URL missing");
if (!scanToken) throw new Error("SCAN_TOKEN missing");

const headers = {
  authorization: `Bearer ${scanToken}`,
  "content-type": "application/json"
};

async function postJson(path: string, payload: unknown) {
  const response = await fetch(`${cloudUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status} ${body.slice(0, 800)}`);
  }
  return body ? JSON.parse(body) as unknown : undefined;
}

async function postSnapshot(path: string, symbol: MarketSymbol, scannedAt: number, payload: unknown) {
  const url = new URL(`${cloudUrl}${path}`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("scannedAt", String(scannedAt));
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${path} ${symbol}: HTTP ${response.status} ${body.slice(0, 800)}`);
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

// Site ile aynı kurallar: Ayar ekranı /api/rules'a yazar, bot buradan okur. Erişilemezse
// defaultRules'a düşer — kural senkronu hiçbir zaman taramayı durduramaz.
async function fetchCloudRules(): Promise<{ rules: typeof defaultRules; source: "cloud" | "default" }> {
  try {
    const response = await fetch(`${cloudUrl}/api/rules`, { headers });
    if (!response.ok) return { rules: defaultRules, source: "default" };
    const body = await response.json() as { rules?: unknown } | null;
    if (!body?.rules) return { rules: defaultRules, source: "default" };
    return { rules: resolveStoredRules(body.rules), source: "cloud" };
  } catch {
    return { rules: defaultRules, source: "default" };
  }
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
  const { rules, source: rulesSource } = await fetchCloudRules();
  const result = scanContexts(contexts, "crt", rules);

  for (const market of markets) {
    await postSnapshot("/api/ingest-market", market.symbol, scannedAt, leanMarketForStorage(market));
    await postSnapshot("/api/ingest-scan", market.symbol, scannedAt, scanSnapshotForSymbol(market.symbol, result));
  }

  const readySignals = alertableReadySignals(result);
  const finalize = await postJson("/api/finalize-scan", {
    scannedAt,
    symbols: markets.map((market) => market.symbol),
    errors,
    alerts: readySignals.map(buildTelegramReadyAlertPayload)
  });

  console.log(JSON.stringify({
    status: "ok",
    scannedAt,
    rulesSource,
    markets: markets.length,
    ready: readySignals.length,
    watch: result.signals.filter((signal) => signal.stage === "watch").length,
    errors,
    finalize
  }));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
