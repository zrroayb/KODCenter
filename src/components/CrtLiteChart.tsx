import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type SeriesMarker,
  type Time
} from "lightweight-charts";
import type { Candle, DealingRange } from "../lib/ict/types";
import { formatPrice } from "../lib/ict/format";

type CrtLiteChartProps = {
  candles: Candle[];
  range?: DealingRange;
  title?: string;
  pivotLen?: number;
  height?: number;
};

// TradingView lightweight-charts port'u: mumlar + CRT range (onceki HTF) H/EQ/L
// cizgileri + MSB (market structure break) kirilim isaretleri + premium/discount.
// Pine indikatoruyle ayni mantik; veriler uygulamanin kendi Candle/DealingRange'inden.

// Uygulama Candle.time'i ms; lightweight-charts saniye (UTCTimestamp) ister.
function toSeconds(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

// Sadece kapanmis, artan-benzersiz zamanli mumlar (setData bunu ister).
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

type MsbMarker = SeriesMarker<Time>;

// Pine'daki MSB mantigi: son swing high/low kirilinca (close ustune/altina) isaret.
function computeMsbMarkers(candles: Candle[], len: number): MsbMarker[] {
  const markers: MsbMarker[] = [];
  let swingHigh: number | null = null;
  let swingHighBroken = false;
  let swingLow: number | null = null;
  let swingLowBroken = false;
  for (let i = 0; i < candles.length; i++) {
    // pivot: len bar geride tam pivot olustu mu (i-len merkezli)
    const p = i - len;
    if (p >= len && p < candles.length - len) {
      let isHigh = true;
      let isLow = true;
      for (let j = p - len; j <= p + len; j++) {
        if (j === p) continue;
        if (candles[j].high >= candles[p].high) isHigh = false;
        if (candles[j].low <= candles[p].low) isLow = false;
      }
      if (isHigh) {
        swingHigh = candles[p].high;
        swingHighBroken = false;
      }
      if (isLow) {
        swingLow = candles[p].low;
        swingLowBroken = false;
      }
    }
    const c = candles[i];
    if (swingHigh != null && !swingHighBroken && c.close > swingHigh) {
      swingHighBroken = true;
      markers.push({ time: toSeconds(c.time), position: "belowBar", color: "#089981", shape: "arrowUp", text: "MSB" });
    }
    if (swingLow != null && !swingLowBroken && c.close < swingLow) {
      swingLowBroken = true;
      markers.push({ time: toSeconds(c.time), position: "aboveBar", color: "#f23645", shape: "arrowDown", text: "MSB" });
    }
  }
  return markers;
}

type RangeStatus = { label: string; tone: "short" | "long" | "premium" | "discount" | "none" };

function rangeStatus(range: DealingRange | undefined, lastClose: number | undefined): RangeStatus {
  if (!range || lastClose == null) return { label: "—", tone: "none" };
  if (lastClose > range.high) return { label: "🔴 üst süzüldü (SHORT bölge)", tone: "short" };
  if (lastClose < range.low) return { label: "🟢 alt süzüldü (LONG bölge)", tone: "long" };
  if (lastClose > range.midpoint) return { label: "premium (üst yarı)", tone: "premium" };
  return { label: "discount (alt yarı)", tone: "discount" };
}

// Fiyat range kenarina yaklasti mi? (sweep/setup oncesi uyari)
// Esik: range yuksekliginin %12'si kadar kenara yaklasinca alarm.
type ProximityAlert = { edge: "HIGH" | "LOW"; msg: string } | null;
function proximityAlert(range: DealingRange | undefined, lastClose: number | undefined): ProximityAlert {
  if (!range || lastClose == null) return null;
  const size = range.high - range.low;
  if (size <= 0) return null;
  const nearHigh = (range.high - lastClose) / size;
  const nearLow = (lastClose - range.low) / size;
  if (lastClose <= range.high && lastClose > range.midpoint && nearHigh <= 0.12) {
    return { edge: "HIGH", msg: `⚠️ RANGE HIGH yakın (${formatPrice(range.high)}) — sweep / SHORT hazırlığı` };
  }
  if (lastClose >= range.low && lastClose < range.midpoint && nearLow <= 0.12) {
    return { edge: "LOW", msg: `⚠️ RANGE LOW yakın (${formatPrice(range.low)}) — sweep / LONG hazırlığı` };
  }
  return null;
}

export function CrtLiteChart({ candles, range, title, pivotLen = 5, height = 460 }: CrtLiteChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const data = useMemo(() => cleanCandles(candles), [candles]);
  const markers = useMemo(() => computeMsbMarkers(candles, pivotLen), [candles, pivotLen]);
  const lastClose = candles.length ? candles[candles.length - 1].close : undefined;
  const status = rangeStatus(range, lastClose);
  const alert = proximityAlert(range, lastClose);
  const notifiedRef = useRef<string>("");

  // Kenara yaklasinca tarayici bildirimi (izin varsa), her yaklasmada bir kez.
  useEffect(() => {
    if (!alert) {
      notifiedRef.current = "";
      return;
    }
    const key = `${title ?? ""}:${alert.edge}`;
    if (notifiedRef.current === key) return;
    notifiedRef.current = key;
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      new Notification(`${title ?? "CRT"} — ${alert.edge}`, { body: alert.msg });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") new Notification(`${title ?? "CRT"} — ${alert.edge}`, { body: alert.msg });
      });
    }
  }, [alert?.edge, alert?.msg, title]);

  // Chart'i bir kez kur.
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
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Veri + markerlar degisince guncelle.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(data);
    series.setMarkers(markers);
    chartRef.current?.timeScale().fitContent();
  }, [data, markers]);

  // Range H/EQ/L cizgileri (onceki HTF mumu).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    const lines = [
      range
        ? series.createPriceLine({ price: range.high, color: "#f23645", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "RANGE HIGH" })
        : null,
      range
        ? series.createPriceLine({ price: range.midpoint, color: "#97a3bd", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "EQ" })
        : null,
      range
        ? series.createPriceLine({ price: range.low, color: "#089981", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "RANGE LOW" })
        : null
    ];
    return () => {
      for (const l of lines) if (l) series.removePriceLine(l);
    };
  }, [range?.high, range?.low, range?.midpoint]);

  const toneColor =
    status.tone === "short" ? "#f23645" : status.tone === "long" ? "#089981" : status.tone === "premium" ? "#f2a33c" : status.tone === "discount" ? "#3c9df2" : "#97a3bd";

  return (
    <div className="crt-lite-chart">
      <div className="crt-lite-chart__head">
        <span className="crt-lite-chart__title">{title ?? "CRT (lightweight-charts)"}</span>
        {range ? (
          <span className="crt-lite-chart__range">
            H {formatPrice(range.high)} · EQ {formatPrice(range.midpoint)} · L {formatPrice(range.low)}
          </span>
        ) : null}
        <span className="crt-lite-chart__status" style={{ color: toneColor }}>
          {status.label}
        </span>
      </div>
      {alert ? (
        <div className={`crt-lite-chart__alert crt-lite-chart__alert--${alert.edge.toLowerCase()}`}>{alert.msg}</div>
      ) : null}
      <div ref={containerRef} style={{ width: "100%", height }} />
    </div>
  );
}
