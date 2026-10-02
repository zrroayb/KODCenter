import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp
} from "lightweight-charts";
import type { ChartBreakLevel, ChartCrtRange } from "../lib/charts/crtRange";
import type { Candle } from "../lib/ict/types";
import { formatPrice } from "../lib/ict/format";

type CrtLiteChartProps = {
  candles: Candle[];
  title?: string;
  height?: number;
  // The engine's authoritative direction (single source; see CLAUDE.md §6).
  bias?: "long" | "short" | "neutral";
  // This tab's own CRT range (previous closed candle of THIS timeframe). Nothing else is drawn
  // about ranges — no other timeframe's lines, no break/status overlays.
  crtRange?: ChartCrtRange;
  rangeLabel?: string;
  // "C2 oluşuyor…" / "C3 · … işlem mumu" — where we are in the 3-candle cycle.
  phaseText?: string;
  // Selected signal's plan: entry / stop / EQ (break-even) / DOL exit.
  plan?: { entry: number; stopLoss: number; targets: number[] };
  // The confirmation-TF level a candle must close beyond (ChoCH / True MSS) and its header text.
  breakLevel?: ChartBreakLevel;
  breakText?: string;
};

// App Candle.time is ms; lightweight-charts wants seconds.
function toSeconds(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

// Closed + forming candles, ascending, unique times (setData requires it).
function cleanCandles(candles: Candle[]) {
  const seen = new Set<number>();
  const out: { time: UTCTimestamp; open: number; high: number; low: number; close: number }[] = [];
  for (const c of [...candles].sort((a, b) => a.time - b.time)) {
    const t = toSeconds(c.time);
    if (seen.has(t)) continue;
    seen.add(t);
    out.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
  }
  return out;
}

// A few empty bars to the right so the range lines visibly run into the current period.
const RIGHT_PAD_BARS = 6;

const BIAS_META: Record<"long" | "short" | "neutral", { text: string; color: string }> = {
  long: { text: "Yön: LONG", color: "#089981" },
  short: { text: "Yön: SHORT", color: "#f23645" },
  neutral: { text: "Yön: NÖTR", color: "#97a3bd" }
};

const RANGE_COLOR = "#ffd700";
// Break level (ChoCH / True MSS) — dataviz accent, distinct from the gold range.
const BREAK_COLOR = "#3987e5";
// Open zoomed on the recent bars (not the whole history): last N candles + the right pad.
const VISIBLE_BARS = 90;

export function CrtLiteChart({ candles, title, height = 460, bias, crtRange, rangeLabel, phaseText, plan, breakLevel, breakText }: CrtLiteChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const rangeSeriesRef = useRef<Array<ISeriesApi<"Line">>>([]);
  const breakSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const data = useMemo(() => cleanCandles(candles), [candles]);
  // Whitespace bars after the last candle (same spacing as the last two bars).
  const padded = useMemo(() => {
    if (data.length < 2) return data;
    const step = data[data.length - 1].time - data[data.length - 2].time;
    const last = data[data.length - 1].time;
    const pad = Array.from({ length: RIGHT_PAD_BARS }, (_, i) => ({ time: (last + step * (i + 1)) as UTCTimestamp }));
    return [...data, ...pad];
  }, [data]);

  // Build the chart once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "#0f131c" }, textColor: "#97a3bd" },
      grid: { vertLines: { color: "rgba(151,163,189,0.06)" }, horzLines: { color: "rgba(151,163,189,0.06)" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(151,163,189,0.18)" },
      timeScale: { borderColor: "rgba(151,163,189,0.18)", timeVisible: true, secondsVisible: false },
      autoSize: true
    });
    const series = chart.addCandlestickSeries({
      upColor: "#089981",
      downColor: "#f23645",
      borderUpColor: "#0bb195",
      borderDownColor: "#f23645",
      wickUpColor: "#0a9981",
      wickDownColor: "#f23645"
    });
    const rangeLine = (style: LineStyle, width: 1 | 2) => chart.addLineSeries({
      color: RANGE_COLOR,
      lineWidth: width,
      lineStyle: style,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: false
    });
    rangeSeriesRef.current = [rangeLine(LineStyle.Solid, 2), rangeLine(LineStyle.Dotted, 1), rangeLine(LineStyle.Solid, 2)];
    breakSeriesRef.current = chart.addLineSeries({
      color: BREAK_COLOR,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: false
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      rangeSeriesRef.current = [];
      breakSeriesRef.current = null;
    };
  }, []);

  // Candles.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(padded);
    const total = padded.length;
    if (total > VISIBLE_BARS + RIGHT_PAD_BARS) {
      chartRef.current?.timeScale().setVisibleLogicalRange({ from: total - RIGHT_PAD_BARS - VISIBLE_BARS, to: total - 1 });
    } else {
      chartRef.current?.timeScale().fitContent();
    }
  }, [padded]);

  // This tab's CRT range: High / EQ / Low from the reference candle to the right edge.
  useEffect(() => {
    const [highSeries, eqSeries, lowSeries] = rangeSeriesRef.current;
    if (!highSeries || !eqSeries || !lowSeries) return;
    const end = padded[padded.length - 1]?.time;
    if (!crtRange || end === undefined) {
      highSeries.setData([]);
      eqSeries.setData([]);
      lowSeries.setData([]);
      return;
    }
    const refTime = toSeconds(crtRange.time);
    const firstBar = padded.find((bar) => bar.time >= refTime) ?? padded[0];
    const start = firstBar.time;
    const tag = rangeLabel ?? "CRT";
    const segment = (value: number) => (end > start ? [{ time: start, value }, { time: end, value }] : [{ time: start, value }]);
    highSeries.applyOptions({ title: `${tag} H` });
    eqSeries.applyOptions({ title: `${tag} EQ` });
    lowSeries.applyOptions({ title: `${tag} L` });
    highSeries.setData(segment(crtRange.high));
    eqSeries.setData(segment(crtRange.eq));
    lowSeries.setData(segment(crtRange.low));
  }, [crtRange?.high, crtRange?.low, crtRange?.eq, crtRange?.time, rangeLabel, padded]);

  // The break the setup waits for: from the swing candle to the right edge.
  useEffect(() => {
    const series = breakSeriesRef.current;
    if (!series) return;
    const end = padded[padded.length - 1]?.time;
    if (!breakLevel || end === undefined) {
      series.setData([]);
      return;
    }
    const swingTime = toSeconds(breakLevel.time);
    const start = (padded.find((bar) => bar.time >= swingTime) ?? padded[0]).time;
    series.applyOptions({
      title: breakLevel.done ? "KIRILDI ✓" : `KIRILIM ${breakLevel.side === "above" ? "↑" : "↓"}`,
      lineStyle: breakLevel.done ? LineStyle.Dotted : LineStyle.Dashed
    });
    series.setData(end > start ? [{ time: start, value: breakLevel.level }, { time: end, value: breakLevel.level }] : [{ time: start, value: breakLevel.level }]);
  }, [breakLevel?.level, breakLevel?.time, breakLevel?.side, breakLevel?.done, padded]);

  // Selected signal's plan: Entry / Stop / EQ (stop -> BE) / Exit. Single-target plans
  // (continuation) draw only the exit.
  const planEntry = plan?.entry;
  const planStop = plan?.stopLoss;
  const planEq = plan && plan.targets.length > 1 ? plan.targets[0] : undefined;
  const planExit = plan ? plan.targets[1] ?? plan.targets[0] : undefined;
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const line = (price: number | undefined, color: string, lineTitle: string, style: LineStyle) =>
      typeof price === "number" && Number.isFinite(price)
        ? series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title: lineTitle })
        : null;
    const lines = [
      line(planEntry, "#e8e4d8", "GİRİŞ", LineStyle.Solid),
      line(planStop, "#f23645", "STOP", LineStyle.Solid),
      line(planEq, "#a9a49a", "EQ → BE", LineStyle.Dashed),
      line(planExit, "#089981", "ÇIKIŞ", LineStyle.Solid)
    ];
    return () => {
      for (const l of lines) if (l) series.removePriceLine(l);
    };
  }, [planEntry, planStop, planEq, planExit]);

  const biasMeta = bias ? BIAS_META[bias] : null;

  return (
    <div className="crt-lite-chart">
      <div className="crt-lite-chart__head">
        <span className="crt-lite-chart__title">{title ?? "CRT"}</span>
        {crtRange ? (
          <span className="crt-lite-chart__range">
            {rangeLabel ?? "CRT"} Candle 1 · H {formatPrice(crtRange.high)} · EQ {formatPrice(crtRange.eq)} · L {formatPrice(crtRange.low)}
          </span>
        ) : null}
        {biasMeta ? (
          <span className="crt-lite-chart__bias" style={{ color: biasMeta.color, fontWeight: 700 }}>
            {biasMeta.text}
          </span>
        ) : null}
      </div>
      {phaseText ? <div className={`crt-lite-chart__phase ${crtRange?.phase ?? ""}`}>{phaseText}</div> : null}
      {breakText ? <div className={`crt-lite-chart__phase break ${breakLevel?.done ? "done" : ""}`}>{breakText}</div> : null}
      <div ref={containerRef} style={{ width: "100%", height }} />
    </div>
  );
}
