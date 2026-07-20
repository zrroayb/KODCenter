import type { TradingSignal } from "../ict/types";
import { captureSignalChartImages, type TelegramChartImage } from "./chartSnapshot";
import {
  buildTelegramReadyAlertPayload,
  crtContextTelegramDedupeKey,
  raidTelegramDedupeKey,
  readyTelegramDedupeKey,
  type TelegramReadyAlertPayload
} from "./alertPayload";
import { SENT_READY_ALERTS_KEY } from "./alertHistory";

export {
  buildTelegramReadyAlertPayload,
  crtContextTelegramDedupeKey,
  raidTelegramDedupeKey,
  readyTelegramDedupeKey
} from "./alertPayload";
export type { TelegramReadyAlertPayload } from "./alertPayload";

const pendingReadyAlerts = new Set<string>();

// Screenshot capture is best-effort: an alert must never be delayed or dropped because a
// chart could not be rasterized.
async function chartsFor(signal: TradingSignal): Promise<Pick<TelegramReadyAlertPayload, "charts">> {
  try {
    const charts = await captureSignalChartImages(signal);
    return charts.length ? { charts } : {};
  } catch {
    return {};
  }
}

type TelegramAlertResponse = {
  status?: "sent" | "disabled" | "error";
  error?: string;
};

function storage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

function loadSentIds(): string[] {
  const raw = storage()?.getItem(SENT_READY_ALERTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveSentIds(ids: string[]) {
  storage()?.setItem(SENT_READY_ALERTS_KEY, JSON.stringify(ids.slice(-160)));
}

export function wasReadyTelegramAlertSent(signalId: string): boolean {
  return loadSentIds().includes(signalId);
}

function markReadyTelegramAlertSent(signalId: string) {
  saveSentIds(Array.from(new Set([...loadSentIds(), signalId])));
}

export async function notifyRaidSignalOnce(signal: TradingSignal): Promise<TelegramAlertResponse> {
  const anchor = signal.crtAnchor;
  if (!anchor?.raidActive || signal.stage !== "watch") return { status: "disabled" };
  const dedupeKey = raidTelegramDedupeKey(signal);
  if (pendingReadyAlerts.has(dedupeKey) || wasReadyTelegramAlertSent(dedupeKey)) return { status: "disabled" };
  pendingReadyAlerts.add(dedupeKey);
  try {
    const payload: TelegramReadyAlertPayload = {
      ...buildTelegramReadyAlertPayload(signal),
      stage: "watch",
      alertKind: "raid",
      rangeTf: anchor.rangeTf,
      confirmTf: anchor.confirmTf,
      rangeHigh: anchor.rangeHigh,
      rangeLow: anchor.rangeLow,
      raidClosed: anchor.raidClosed,
      reasons: [
        `${anchor.rangeTf.toUpperCase()} CRT ${signal.direction === "short" ? "high" : "low"} alındı; ${anchor.rangeTf.toUpperCase()} mum kapanışı beklenmiyor`,
        `${anchor.confirmTf} ChoCH/Just kapanışı bekleniyor`,
        ...(signal.governance.blockers.slice(0, 2))
      ],
      tradeContext: undefined,
      ...(await chartsFor(signal))
    };
    const response = await fetch("/api/telegram/ready-alert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({})) as TelegramAlertResponse;
    if (response.ok && result.status === "sent") {
      markReadyTelegramAlertSent(dedupeKey);
    }
    return result;
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  } finally {
    pendingReadyAlerts.delete(dedupeKey);
  }
}

export async function notifyCrtContextSignalOnce(signal: TradingSignal): Promise<TelegramAlertResponse> {
  const anchor = signal.crtAnchor;
  const bias = signal.evidence.find((item) => item.id === "crt-bias");
  const highTimeframe = anchor?.rangeTf === "1d" || anchor?.rangeTf === "1w";
  const fvgOriginContext = anchor?.origin === "fvg-origin";
  if (!anchor || signal.stage !== "watch" || anchor.raidActive || (!highTimeframe && !fvgOriginContext) || signal.score < 50 || (!fvgOriginContext && bias?.status !== "pass")) {
    return { status: "disabled" };
  }
  const contextLine = fvgOriginContext
    ? `${anchor.originLabel ?? "4H FVG origin CRT"} aktif: FVG taplendi, origin candle CRT range olarak izleniyor.`
    : `${anchor.rangeTf.toUpperCase()} CRT yön verdi: ${bias?.detail ?? "HTF bias aktif."}`;
  const dedupeKey = crtContextTelegramDedupeKey(signal);
  if (pendingReadyAlerts.has(dedupeKey) || wasReadyTelegramAlertSent(dedupeKey)) return { status: "disabled" };
  pendingReadyAlerts.add(dedupeKey);
  try {
    const payload: TelegramReadyAlertPayload = {
      ...buildTelegramReadyAlertPayload(signal),
      stage: "watch",
      alertKind: "context",
      rangeTf: anchor.rangeTf,
      confirmTf: anchor.confirmTf,
      rangeHigh: anchor.rangeHigh,
      rangeLow: anchor.rangeLow,
      reasons: [
        contextLine,
        `Bu entry değil; önce range kenarı sweep, sonra ${anchor.confirmTf} ChoCH/Just kapanışı gerekir.`,
        ...(signal.governance.blockers.slice(0, 2))
      ],
      tradeContext: undefined,
      ...(await chartsFor(signal))
    };
    const response = await fetch("/api/telegram/ready-alert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({})) as TelegramAlertResponse;
    if (response.ok && result.status === "sent") {
      markReadyTelegramAlertSent(dedupeKey);
    }
    return result;
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : "Telegram context alert failed" };
  } finally {
    pendingReadyAlerts.delete(dedupeKey);
  }
}

export async function notifyReadySignalOnce(signal: TradingSignal): Promise<TelegramAlertResponse> {
  if (signal.stage !== "ready") return { status: "disabled" };
  const dedupeKey = readyTelegramDedupeKey(signal);
  if (pendingReadyAlerts.has(dedupeKey) || wasReadyTelegramAlertSent(dedupeKey)) return { status: "disabled" };
  pendingReadyAlerts.add(dedupeKey);
  try {
    const response = await fetch("/api/telegram/ready-alert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...buildTelegramReadyAlertPayload(signal), ...(await chartsFor(signal)) })
    });
    const result = await response.json().catch(() => ({})) as TelegramAlertResponse;
    if (response.ok && result.status === "sent") {
      markReadyTelegramAlertSent(dedupeKey);
    }
    return result;
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : String(error) };
  } finally {
    pendingReadyAlerts.delete(dedupeKey);
  }
}
