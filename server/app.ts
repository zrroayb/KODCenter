// Live server for `vite` (dev) and `vite preview` (Render): route table, Yahoo proxy, economic
// calendar and the public-endpoint guard. Gemini lives in ./gemini.ts, Telegram alerts in
// ./telegram.ts, shared HTTP helpers in ./http.ts. Moved out of vite.config.ts (2026-10-10).
import type { Plugin } from "vite";
import process from "node:process";
import { clientIp, createRateLimiter, isSameSite } from "./publicGuard";
import { FF_CALENDAR_URL, parseForexFactoryWeek } from "../src/lib/data/economicCalendar";
import type { CalendarEvent } from "../src/data/eventCalendar";
import { type YahooProxyRequest, type YahooProxyResponse, type TelegramEnv, type JsonRequest, SERVER_STARTED_AT, jsonResponse } from "./http";
import { handleGeminiCrtAnalysis, handleGeminiTradeCommentary, handleGeminiMarketPick, handleGeminiReplayReview } from "./gemini";
import { handleTelegramReadyAlert, handleLiveAlerts } from "./telegram";

const yahooUserAgent = "Mozilla/5.0";

async function handleYahooProxy(request: YahooProxyRequest, response: YahooProxyResponse) {
  const requestPath = `/${(request.url ?? "").replace(/^\/+/, "").replace(/^yahoo\/?/, "")}`;
  // Only the chart endpoint the app uses; the proxy must not relay arbitrary Yahoo paths.
  if (!requestPath.startsWith("/v8/finance/chart/")) {
    jsonResponse(response, 404, { status: "error", error: "Not found" });
    return;
  }
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

// Gemini spends the owner's quota: same-site pages only, 20 calls / 10 min per IP, 300 / hour total.

const geminiPerIp = createRateLimiter(20, 10 * 60 * 1000);

const geminiGlobal = createRateLimiter(300, 60 * 60 * 1000);
// Yahoo proxy: a page load is ~48 requests (12 symbols x 4 intervals) and it refreshes every minute.

const yahooPerIp = createRateLimiter(1200, 10 * 60 * 1000);

function guarded(kind: "gemini" | "yahoo", handler: (request: JsonRequest, response: YahooProxyResponse) => void | Promise<void>) {
  return (request: JsonRequest, response: YahooProxyResponse) => {
    if (!isSameSite(request)) {
      jsonResponse(response, 403, { status: "error", error: "Forbidden: same-site requests only" });
      return;
    }
    const ip = clientIp(request);
    const allowed = kind === "gemini" ? geminiPerIp(ip) && geminiGlobal("all") : yahooPerIp(ip);
    if (!allowed) {
      jsonResponse(response, 429, { status: "error", error: "Too many requests" });
      return;
    }
    void handler(request, response);
  };
}

// Weekly economic calendar for the browser (no CORS on the source), cached 1 hour in memory.

let calendarCache: { at: number; events: CalendarEvent[] } | undefined;

async function handleCalendar(_request: JsonRequest, response: YahooProxyResponse) {
  const now = Date.now();
  if (!calendarCache || now - calendarCache.at > 60 * 60 * 1000) {
    try {
      const upstream = await fetch(FF_CALENDAR_URL, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" } });
      const events = upstream.ok ? parseForexFactoryWeek(await upstream.json()) : [];
      // Keep a previous good copy when the feed hiccups.
      calendarCache = events.length || !calendarCache ? { at: now, events } : { ...calendarCache, at: now };
    } catch {
      calendarCache = calendarCache ?? { at: now, events: [] };
    }
  }
  jsonResponse(response, 200, { status: calendarCache.events.length ? "ok" : "empty", events: calendarCache.events });
}

// One route table for `vite` (dev) and `vite preview` (Render).

function registerRoutes(server: { middlewares: { use: (path: string, handler: (request: JsonRequest, response: YahooProxyResponse) => void) => void } }, env: TelegramEnv) {
  server.middlewares.use("/yahoo", guarded("yahoo", (request, response) => handleYahooProxy(request, response)));
  // Bearer SCAN_TOKEN auth inside the handler (the GitHub scanner is not a browser page).
  server.middlewares.use("/api/telegram/ready-alert", (request, response) => {
    void handleTelegramReadyAlert(request, response, env);
  });
  // Cheap liveness probe: Render health check + keep-alive pings (free plan sleeps after 15 idle min).
  server.middlewares.use("/api/health", (_request, response) => {
    jsonResponse(response, 200, { status: "ok", startedAt: SERVER_STARTED_AT, uptimeSec: Math.round(process.uptime()) });
  });
  server.middlewares.use("/api/calendar", guarded("yahoo", (request, response) => handleCalendar(request, response)));
  server.middlewares.use("/api/live-alerts", (request, response) => {
    handleLiveAlerts(request, response, env);
  });
  server.middlewares.use("/api/gemini/trade-commentary", guarded("gemini", (request, response) => handleGeminiTradeCommentary(request, response, env)));
  server.middlewares.use("/api/gemini/replay-review", guarded("gemini", (request, response) => handleGeminiReplayReview(request, response, env)));
  server.middlewares.use("/api/gemini/market-pick", guarded("gemini", (request, response) => handleGeminiMarketPick(request, response, env)));
  server.middlewares.use("/api/gemini/crt-analysis", guarded("gemini", (request, response) => handleGeminiCrtAnalysis(request, response, env)));
}

export function yahooFinanceProxy(env: TelegramEnv): Plugin {
  return {
    name: "local-yahoo-finance-proxy",
    configureServer(server) {
      registerRoutes(server, env);
    },
    configurePreviewServer(server) {
      registerRoutes(server, env);
    }
  };
}
