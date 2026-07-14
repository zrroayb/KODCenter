import { createElement, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { CandleChart } from "../../components/CandleChart";
import type { Candle, TradingSignal, Timeframe } from "../ict/types";

export type TelegramChartImage = { label: string; dataUrl: string };

type ChartMode = "execution" | "confirmation" | "context" | "daily";

type SnapshotSpec = {
  candles: Candle[];
  title: string;
  label: string;
  mode: ChartMode;
  chartTimeframe: Timeframe;
};

const RANGE_SERIES: Record<string, { key: "h4" | "daily" | "weekly"; mode: ChartMode }> = {
  "4h": { key: "h4", mode: "context" },
  "1d": { key: "daily", mode: "daily" },
  "1w": { key: "weekly", mode: "daily" }
};

const CONFIRM_SERIES: Record<string, { key: "m15" | "h1" | "h4"; mode: ChartMode }> = {
  "15m": { key: "m15", mode: "execution" },
  "1h": { key: "h1", mode: "confirmation" },
  "4h": { key: "h4", mode: "context" }
};

function snapshotSpec(signal: TradingSignal, kind: "range" | "confirm"): SnapshotSpec | undefined {
  const anchor = signal.crtAnchor;
  if (!anchor) return undefined;
  const pick = kind === "range" ? RANGE_SERIES[anchor.rangeTf] : CONFIRM_SERIES[anchor.confirmTf];
  if (!pick) return undefined;
  const series = signal.context.timeframes[pick.key] ?? [];
  const keep = kind === "range" ? 60 : 130;
  const candles = series.slice(Math.max(0, series.length - keep));
  if (candles.length < 10) return undefined;
  const tfLabel = (kind === "range" ? anchor.rangeTf : anchor.confirmTf).toUpperCase();
  return {
    candles,
    title: kind === "range"
      ? `${signal.symbol} · ${tfLabel} CRT Range`
      : `${signal.symbol} · ${tfLabel} confirmation`,
    label: kind === "range"
      ? `${signal.symbol} ${signal.direction.toUpperCase()} · CRT range mumu (${tfLabel})`
      : `${signal.symbol} ${signal.direction.toUpperCase()} · onay grafiği (${tfLabel})`,
    mode: pick.mode,
    chartTimeframe: (kind === "range" ? anchor.rangeTf : anchor.confirmTf) as Timeframe
  };
}

// In the browser the page's own React runtime must do the rendering — react-dom/server's
// browser build has its own hook dispatcher and throws "Invalid hook call" next to a live
// React app. In node (tests) there is no DOM, so renderToStaticMarkup is the right tool.
function componentMarkup(element: ReactElement): string {
  if (typeof document === "undefined") return renderToStaticMarkup(element);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    flushSync(() => root.render(element));
    return host.innerHTML;
  } finally {
    root.unmount();
  }
}

export function renderSignalChartSvg(signal: TradingSignal, kind: "range" | "confirm"): { svg: string; label: string } | undefined {
  const spec = snapshotSpec(signal, kind);
  if (!spec) return undefined;
  const markup = componentMarkup(createElement(CandleChart, {
    candles: spec.candles,
    title: spec.title,
    mode: spec.mode,
    context: signal.context,
    signals: [signal],
    selectedSignal: signal,
    showSignalMarkers: true,
    chartTimeframe: spec.chartTimeframe
  }));
  const start = markup.indexOf("<svg");
  const end = markup.lastIndexOf("</svg>");
  if (start < 0 || end < 0) return undefined;
  let svg = markup.slice(start, end + "</svg>".length);
  // The chart normally inherits page styles; a standalone SVG needs its own namespace, font
  // and dark ground so the Telegram photo matches what the app shows.
  if (!svg.includes("xmlns=")) svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  svg = svg.replace(
    "<svg",
    '<svg style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#0b1018"'
  );
  return { svg, label: spec.label };
}

async function svgToJpegDataUrl(svg: string): Promise<string | undefined> {
  if (typeof document === "undefined" || typeof Image === "undefined") return undefined;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("chart svg rasterization failed"));
      img.src = url;
    });
    const scale = 1.4;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(1120 * scale);
    canvas.height = Math.round(620 * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.fillStyle = "#0b1018";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Captures the CRT range-TF chart and the confirmation-TF chart for a signal as JPEG data
// URLs. Browser-only (needs canvas); in node or on any failure it returns [] so an alert can
// never be blocked by its screenshots.
export async function captureSignalChartImages(signal: TradingSignal): Promise<TelegramChartImage[]> {
  const images: TelegramChartImage[] = [];
  for (const kind of ["range", "confirm"] as const) {
    try {
      const rendered = renderSignalChartSvg(signal, kind);
      if (!rendered) continue;
      const dataUrl = await svgToJpegDataUrl(rendered.svg);
      if (dataUrl) images.push({ label: rendered.label, dataUrl });
    } catch {
      // screenshots are best-effort; the text alert must still go out
    }
  }
  return images;
}
