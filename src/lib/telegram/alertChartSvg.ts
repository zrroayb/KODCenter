import type { Candle, DealingRange, TradingSignal } from "../ict/types";

// React'siz, tarayici gerektirmeyen bagimsiz SVG chart — alert gorseli icin.
// Node'da (cloud-scan) resvg ile PNG'ye rasterlenir; worker bunu Telegram'a foto atar.
// CandleChart'in SSR'da patlayan (browser-only) yollarindan kacinmak icin ayri tutuldu.

const CONFIRM_KEY: Record<string, "m15" | "h1" | "h4"> = { "15m": "m15", "1h": "h1", "4h": "h4" };

function fmt(n: number): string {
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 1 : abs >= 1 ? 2 : 5;
  return n.toFixed(digits);
}

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"));
}

export function signalAlertChartSvg(signal: TradingSignal): { svg: string; label: string } | undefined {
  const anchor = signal.crtAnchor;
  const confirmTf = anchor?.confirmTf;
  const key = (confirmTf && CONFIRM_KEY[confirmTf]) || "h1";
  const series = signal.context.timeframes[key] ?? signal.context.timeframes.h1 ?? [];
  const candles = series.slice(Math.max(0, series.length - 120));
  if (candles.length < 10) return undefined;
  const range: DealingRange = anchor
    ? { high: anchor.rangeHigh, low: anchor.rangeLow, midpoint: (anchor.rangeHigh + anchor.rangeLow) / 2, source: "crt" }
    : signal.context.dealingRange;
  const svg = buildSvg(candles, range, signal);
  const label = `${signal.symbol} ${signal.direction.toUpperCase()} · ${(confirmTf ?? "1h").toUpperCase()} CRT`;
  return { svg, label };
}

function buildSvg(candles: Candle[], range: DealingRange | undefined, signal: TradingSignal): string {
  const width = 1120;
  const height = 620;
  const pad = { l: 10, r: 104, t: 38, b: 26 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;

  let hi = -Infinity;
  let lo = Infinity;
  for (const c of candles) {
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
  }
  if (range) {
    hi = Math.max(hi, range.high);
    lo = Math.min(lo, range.low);
  }
  hi = Math.max(hi, signal.plan.entry, signal.plan.stopLoss);
  lo = Math.min(lo, signal.plan.entry, signal.plan.stopLoss);
  const spanPad = (hi - lo) * 0.05 || 1;
  hi += spanPad;
  lo -= spanPad;

  const xOf = (i: number) => pad.l + ((i + 0.5) / candles.length) * plotW;
  const yOf = (p: number) => pad.t + ((hi - p) / (hi - lo)) * plotH;
  const cw = Math.max(1, (plotW / candles.length) * 0.62);

  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#0f131c"/>`);
  parts.push(`<text x="${pad.l}" y="24" fill="#e6ebf5" font-size="16" font-weight="700">${esc(signal.symbol)} · ${signal.direction.toUpperCase()}</text>`);

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const up = c.close >= c.open;
    const col = up ? "#089981" : "#f23645";
    const cx = xOf(i);
    parts.push(`<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${yOf(c.high).toFixed(1)}" y2="${yOf(c.low).toFixed(1)}" stroke="${col}" stroke-width="1"/>`);
    const yo = yOf(c.open);
    const yc = yOf(c.close);
    parts.push(`<rect x="${(cx - cw / 2).toFixed(1)}" y="${Math.min(yo, yc).toFixed(1)}" width="${cw.toFixed(1)}" height="${Math.max(1, Math.abs(yc - yo)).toFixed(1)}" fill="${col}"/>`);
  }

  const hline = (price: number, color: string, label: string, dash = "5 4") => {
    if (!Number.isFinite(price)) return;
    const yy = yOf(price);
    parts.push(`<line x1="${pad.l}" x2="${(pad.l + plotW).toFixed(1)}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="${color}" stroke-width="1.2" stroke-dasharray="${dash}"/>`);
    parts.push(`<rect x="${(pad.l + plotW + 2).toFixed(1)}" y="${(yy - 9).toFixed(1)}" width="98" height="18" rx="3" fill="${color}"/>`);
    parts.push(`<text x="${(pad.l + plotW + 7).toFixed(1)}" y="${(yy + 4).toFixed(1)}" fill="#0f131c" font-size="11" font-weight="700">${label} ${fmt(price)}</text>`);
  };

  if (range) {
    hline(range.high, "#f23645", "RANGE H");
    hline(range.midpoint, "#97a3bd", "EQ");
    hline(range.low, "#089981", "RANGE L");
  }
  hline(signal.plan.entry, "#3c9df2", "GIRIS", "2 3");
  hline(signal.plan.stopLoss, "#f2a33c", "STOP", "2 3");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Arial,Helvetica,sans-serif">${parts.join("")}</svg>`;
}
