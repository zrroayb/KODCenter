// Shared HTTP helpers and types for the live server (split from server/app.ts, 2026-10-10).
import type { IncomingMessage, ServerResponse } from "node:http";

export type YahooProxyRequest = IncomingMessage;

export type YahooProxyResponse = ServerResponse;

export type TelegramEnv = {
  // Shared secret between the GitHub Actions scanner and this server. Without it the alert
  // endpoint is closed (fail-closed): nobody can post to Telegram through the public URL.
  SCAN_TOKEN?: string;
  ALERT_STORE_PATH?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  GEMINI_MODEL?: string;
};

export type JsonRequest = IncomingMessage;

export const SERVER_STARTED_AT = new Date().toISOString();

export function jsonResponse(response: YahooProxyResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

export function readJsonBody(request: JsonRequest): Promise<unknown> {
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

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatTelegramPrice(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(5);
}

export function formatTelegramR(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? `1:${value.toFixed(2)}` : "-";
}

export function clampText(value: unknown, max = 2800) {
  const text = typeof value === "string" ? value : "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
