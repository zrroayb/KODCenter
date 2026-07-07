import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { focusChartOnSignal, selectedSignalAnnotations, signalAnchorTime, signalConfirmTimeframe, type FocusedTimeRange } from "../lib/charts/selectedSignal";
import { formatPrice, formatR } from "../lib/ict/format";
import type { Candle, DealingRange, MarketContext, Timeframe, TradingSignal } from "../lib/ict/types";
import { sessionDurationHours, sessionWindows } from "../lib/session/sessionClock";
import { closeConfirmationRequirement, type CloseConfirmationRequirement } from "../lib/signals/waitingGuidance";

type ChartMode = "execution" | "confirmation" | "context" | "daily";

type CandleChartProps = {
  candles: Candle[];
  title: string;
  mode: ChartMode;
  range?: DealingRange;
  context?: MarketContext;
  signals?: TradingSignal[];
  selectedSignal?: TradingSignal | null;
  focusedTimeRange?: FocusedTimeRange;
  showSignalMarkers?: boolean;
  chartTimeframe?: Timeframe;
  onSelectSignal?: (signal: TradingSignal) => void;
};

const width = 1120;
const height = 620;
const plot = {
  left: 26,
  right: 184,
  top: 46,
  bottom: 38
};
const plotRight = width - plot.right;
const plotBottom = height - plot.bottom;
const bull = "#089981";
const bear = "#f23645";
const cleanChartBackground = "#E8E5E0";
const cleanCandleUp = "#FFFFFF";
const cleanCandleDown = "#191D24";
const cleanCandleWick = "#4C5057";
const cleanCandleUpStroke = "#565A61";
const cleanCandleDownStroke = "#191D24";
const grid = "rgba(25, 29, 36, 0.11)";
const minorGrid = "rgba(25, 29, 36, 0.055)";
const dayMs = 24 * 60 * 60 * 1000;

function defaultVisibleCount(mode: ChartMode): number {
  // TradingView-like zoom: ~50-70 readable bars instead of a wall of matchsticks.
  if (mode === "execution") return 72;
  if (mode === "confirmation") return 72;
  if (mode === "context") return 48;
  return 45;
}

function visibleCandles(candles: Candle[], range: FocusedTimeRange | undefined, mode: ChartMode): Candle[] {
  if (!range) return candles.slice(-defaultVisibleCount(mode));
  const focused = candles.filter((candle) => candle.time >= range.from && candle.time <= range.to);
  // Hard readability cap: whatever the focus range says, never squeeze more than ~130 bars
  // into one screen — keep the most recent side where the live action is.
  if (focused.length > 130) return focused.slice(-130);
  const minimum = mode === "execution" ? 48 : 32;
  if (focused.length >= Math.min(minimum, candles.length)) return focused;

  const anchor = range.from + (range.to - range.from) / 2;
  const closestIndex = candles.reduce((best, candle, index) => {
    const distance = Math.abs(candle.time - anchor);
    const bestDistance = Math.abs(candles[best]?.time - anchor);
    return distance < bestDistance ? index : best;
  }, 0);
  const half = Math.floor(minimum / 2);
  return candles.slice(Math.max(0, closestIndex - half), Math.min(candles.length, closestIndex + half));
}

function timeLabel(time: number, mode: ChartMode) {
  const date = new Date(time);
  if (mode === "daily") return date.toLocaleDateString(undefined, { month: "short", day: "2-digit" });
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function priceTicks(high: number, low: number, count = 7) {
  return Array.from({ length: count }, (_, index) => high - ((high - low) / (count - 1)) * index);
}

function snap(value: number) {
  return Math.round(value) + 0.5;
}

function nearestCandle(candles: Candle[], time: number) {
  return candles.reduce((best, candle) => (Math.abs(candle.time - time) < Math.abs(best.time - time) ? candle : best), candles[0]);
}

function setupStatus(signal: TradingSignal) {
  return `${signal.direction.toUpperCase()} ${signal.stage.toUpperCase()} · ${signal.grade} · ${formatR(signal.plan.rr)}`;
}

function stageColor(signal: TradingSignal) {
  if (signal.stage === "ready") return bull;
  if (signal.stage === "invalidated") return bear;
  if (signal.stage === "missed") return "#64748b";
  return "#f59e0b";
}

function stopSourceText(signal: TradingSignal) {
  if (signal.plan.stopSource === "sweep") return signal.direction === "short" ? "sweep üstü" : "sweep altı";
  if (signal.plan.stopSource === "fvg") return signal.direction === "short" ? "FVG üstü" : "FVG altı";
  if (signal.plan.stopSource === "swing") return signal.direction === "short" ? "swing üstü" : "swing altı";
  if (signal.plan.stopSource === "manipulation") return signal.direction === "short" ? "manipulation wick üstü" : "manipulation wick altı";
  return "volatility floor";
}

function entryGapLabel(signal: TradingSignal) {
  if (signal.plan.entrySource === "ifvg-retest") return "iFVG";
  if (signal.plan.entrySource === "fvg-retest") return "FVG";
  return "POI";
}

function compactDecisionText(text: string): string {
  return text.length > 132 ? `${text.slice(0, 129)}...` : text;
}

function chartDecisionText(signal: TradingSignal, closeRequirement: CloseConfirmationRequirement | null): string {
  if (signal.stage === "invalidated") return compactDecisionText("TEK KARAR: alma. Stop/invalidation görüldü, yeni setup bekle.");
  if (signal.stage === "missed") return compactDecisionText("TEK KARAR: kovalamadan bekle. Entry veya hedef kaçmış.");
  if (signal.governance.status === "block") return compactDecisionText(`TEK KARAR: alma. ${signal.governance.blockers[0] ?? "Governance blok var."}`);
  if (closeRequirement) {
    const sideText = closeRequirement.side === "above" ? "üstünde" : "altında";
    const refText = closeRequirement.reference === "last-closed-high" ? "son mum high" : "son mum low";
    return compactDecisionText(`TEK KARAR: ${closeRequirement.timeframe} mum ${formatPrice(closeRequirement.level)} ${sideText} kapanmalı (${refText}).`);
  }
  if (!signal.plan.entryModel.retested || signal.plan.entryStatus === "pending") {
    const gap = signal.plan.entryModel.fairValueGap;
    const entryText = gap
      ? `${formatPrice(gap.low)}-${formatPrice(gap.high)} entry kutusuna`
      : `${formatPrice(signal.plan.entry)} entry seviyesine`;
    return compactDecisionText(`TEK KARAR: fiyat ${entryText} gelsin, kapanışla onaylasın.`);
  }
  if (signal.stage === "ready") {
    return compactDecisionText(`TEK KARAR: READY. Giriş ${formatPrice(signal.plan.entry)} · Stop ${formatPrice(signal.plan.stopLoss)} · EQ ${formatPrice(signal.plan.targets[0] ?? signal.plan.entry)} · DOL ${formatPrice(signal.plan.targets[1] ?? signal.plan.targets[0] ?? signal.plan.entry)}.`);
  }
  return compactDecisionText(signal.plan.planWarnings[0]
    ? `TEK KARAR: bekle. ${signal.plan.planWarnings[0]}`
    : "TEK KARAR: setup izleniyor; READY olmadan işlem yok.");
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function hourToMs(hour: number): number {
  return Math.round(hour * 60 * 60 * 1000);
}

function sessionLabel(sessionName: string) {
  if (sessionName === "Asia") return { short: "AS", title: "Asia" };
  if (sessionName === "London") return { short: "LO", title: "London" };
  if (sessionName === "New York AM") return { short: "NYAM", title: "NY" };
  return { short: "LC", title: "LDN Close" };
}

function sessionStyle(sessionName: string) {
  if (sessionName === "Asia") {
    return {
      fill: "rgba(37, 99, 235, 0.06)",
      stroke: "rgba(96, 165, 250, 0.32)",
      text: "rgba(96, 165, 250, 0.42)"
    };
  }
  if (sessionName === "London") {
    return {
      fill: "rgba(239, 68, 68, 0.055)",
      stroke: "rgba(248, 113, 113, 0.3)",
      text: "rgba(248, 113, 113, 0.4)"
    };
  }
  return {
    fill: "rgba(20, 184, 166, 0.06)",
    stroke: "rgba(45, 212, 191, 0.32)",
    text: "rgba(45, 212, 191, 0.42)"
  };
}

export function CandleChart({
  candles,
  title,
  mode,
  range,
  context,
  signals = [],
  selectedSignal,
  focusedTimeRange,
  showSignalMarkers = true,
  chartTimeframe,
  onSelectSignal
}: CandleChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const visible = visibleCandles(candles, focusedTimeRange, mode);
  if (!visible.length) {
    return (
      <figure className="chart-panel tradingview-chart">
        <figcaption>{title}</figcaption>
        <div className="empty-chart">Chart verisi yok.</div>
      </figure>
    );
  }

  // The setup overlay (ChoCH, manipulation, POI box, reference candle) is drawn on the
  // signal's OWN confirmation timeframe chart: 4H anchor -> 15m, 1D -> 1H, 1W -> 4H.
  // Its annotation candleIndex values point into exactly these candles.
  const selectedConfirmTf = selectedSignal ? signalConfirmTimeframe(selectedSignal) : undefined;
  const chartTf = chartTimeframe ?? (mode === "execution" ? "15m" : undefined);
  const selectedIsConfirmationChart = Boolean(selectedSignal && chartTf
    && (selectedConfirmTf === chartTf || (chartTf === "15m" && selectedConfirmTf === "5m")));
  const selectedIsHigherTimeframe = Boolean(selectedSignal && !selectedIsConfirmationChart);
  const annotations = selectedSignal ? selectedSignalAnnotations(selectedSignal) : undefined;
  const closeRequirement = selectedSignal ? closeConfirmationRequirement(selectedSignal) : null;
  // The close-requirement reference candle is indexed on the confirmation TF; its box only
  // lands on the right candle when this chart IS that timeframe.
  const closeReqOnChart = Boolean(closeRequirement && chartTf
    && (closeRequirement.timeframe === chartTf || (chartTf === "15m" && closeRequirement.timeframe === "5m")));
  const latest = visible[visible.length - 1] as Candle;
  const first = visible[0] as Candle;
  const selectedLevels = selectedSignal
    ? [
        selectedSignal.plan.entry,
        selectedSignal.plan.stopLoss,
        ...selectedSignal.plan.targets,
        ...(selectedIsConfirmationChart ? [
        annotations?.fairValueGap?.high,
        annotations?.fairValueGap?.low,
        annotations?.sweep?.level,
        annotations?.marketStructureShift?.level,
        closeRequirement?.level
        ] : [])
      ].filter((level): level is number => typeof level === "number")
    : [];
  const allContextLevels = [
    ...(range ? [range.high, range.low, range.midpoint] : []),
    ...(context?.liquidityPools.map((pool) => pool.level) ?? [])
  ];
  const candleHigh = Math.max(...visible.map((candle) => candle.high));
  const candleLow = Math.min(...visible.map((candle) => candle.low));
  const candleSpan = Math.max(candleHigh - candleLow, 0.000001);
  const contextLevels = allContextLevels.filter((level) => level >= candleLow - candleSpan * 0.35 && level <= candleHigh + candleSpan * 0.35);
  // A higher-anchor plan's far targets must not define the y-domain: stretching the axis to a
  // level 5 ranges away squeezes the candles into unreadable dots. Far levels stay as clamped
  // edge tags instead.
  const nearSelectedLevels = selectedLevels.filter((level) => level >= candleLow - candleSpan * 1.2 && level <= candleHigh + candleSpan * 1.2);
  const rawHigh = Math.max(candleHigh, ...contextLevels, ...nearSelectedLevels);
  const rawLow = Math.min(candleLow, ...contextLevels, ...nearSelectedLevels);
  const padding = Math.max((rawHigh - rawLow) * 0.12, candleSpan * 0.1);
  const high = rawHigh + padding;
  const low = rawLow - padding;
  const scaleYRaw = (price: number) => plot.top + ((high - price) / Math.max(high - low, 0.000001)) * (plotBottom - plot.top);
  // Overlay drawing clamps into the plot so off-domain plan levels render at the edge
  // (their edge tags carry the real price) instead of painting outside the canvas.
  const scaleY = (price: number) => Math.max(plot.top, Math.min(plotBottom, scaleYRaw(price)));
  const futureBars = selectedSignal ? (mode === "execution" ? 10 : 6) : 0;
  const step = (plotRight - plot.left) / Math.max(visible.length + futureBars, 1);
  const candleWidth = Math.max(4, Math.min(13, Math.floor(step * 0.72)));
  const visibleStartIndex = Math.max(0, candles.findIndex((candle) => candle.time === first?.time));
  const xAtVisibleIndex = (index: number) => plot.left + index * step + step / 2;
  const xForTime = (time: number) => {
    const index = visible.reduce((best, candle, currentIndex) => {
      const distance = Math.abs(candle.time - time);
      const bestDistance = Math.abs(visible[best]?.time - time);
      return distance < bestDistance ? currentIndex : best;
    }, 0);
    return xAtVisibleIndex(index);
  };
  const xForCandleIndex = (index: number) => xAtVisibleIndex(Math.min(Math.max(index - visibleStartIndex, 0), visible.length - 1));
  const xForExactTime = (time: number) => {
    const firstX = xAtVisibleIndex(0);
    const lastX = xAtVisibleIndex(visible.length - 1);
    if (latest.time === first.time) return firstX;
    const ratio = Math.max(0, Math.min(1, (time - first.time) / (latest.time - first.time)));
    return firstX + (lastX - firstX) * ratio;
  };
  const showPremiumDiscountBand = Boolean(range && contextLevels.includes(range.high) && contextLevels.includes(range.low) && contextLevels.includes(range.midpoint));
  const timeIndexes = Array.from(new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map((ratio) => Math.min(visible.length - 1, Math.max(0, Math.round((visible.length - 1) * ratio))))));
  const lastPriceColor = latest && latest.close >= latest.open ? "#6F7278" : cleanCandleDown;
  const seenLiquidityLevels = new Set<string>();
  const visibleLiquidity = (context?.liquidityPools ?? [])
    .filter((pool) => contextLevels.includes(pool.level))
    .sort((a, b) => Math.abs(a.level - (latest?.close ?? a.level)) - Math.abs(b.level - (latest?.close ?? b.level)))
    .filter((pool) => {
      const key = `${pool.side}-${pool.level.toFixed(6)}`;
      if (seenLiquidityLevels.has(key)) return false;
      seenLiquidityLevels.add(key);
      return true;
    })
    .slice(0, selectedSignal ? 3 : 5);
  const chartBackground = cleanChartBackground;
  const plotBackground = cleanChartBackground;
  const gridColor = grid;
  const axisColor = "#6F7278";
  const axisLineColor = "rgba(25, 29, 36, 0.26)";
  const hudFill = "rgba(232, 229, 224, 0.88)";
  const hudText = "#191D24";
  const sessionRanges = (() => {
    if (mode !== "execution") return [];

    const ranges: Array<{
      key: string;
      title: string;
      short: string;
      x1: number;
      x2: number;
      yHigh: number;
      yLow: number;
      highPrice: number;
      lowPrice: number;
      fill: string;
      stroke: string;
      text: string;
    }> = [];
    const visibleStartDay = startOfUtcDay(first.time) - dayMs;
    const visibleEndDay = startOfUtcDay(latest.time) + dayMs;
    const sessions = sessionWindows().filter((session) => session.name !== "Outside");

    for (let dayStart = visibleStartDay; dayStart <= visibleEndDay; dayStart += dayMs) {
      for (const session of sessions) {
        const start = dayStart + hourToMs(session.startHourUtc);
        const end = start + hourToMs(sessionDurationHours(session));
        if (end < first.time || start > latest.time) continue;

        const sessionCandles = visible.filter((candle) => candle.time >= start && candle.time < end);
        if (sessionCandles.length < 2) continue;

        const highPrice = Math.max(...sessionCandles.map((candle) => candle.high));
        const lowPrice = Math.min(...sessionCandles.map((candle) => candle.low));
        const x1 = Math.max(plot.left, xForExactTime(Math.max(start, first.time)) - step / 2);
        const x2 = Math.min(plotRight, xForExactTime(Math.min(end, latest.time)) + step / 2);
        if (x2 - x1 < 18) continue;

        const labels = sessionLabel(session.name);
        const colors = sessionStyle(session.name);
        ranges.push({
          key: `${session.name}-${dayStart}`,
          title: labels.title,
          short: labels.short,
          x1,
          x2,
          yHigh: scaleY(highPrice),
          yLow: scaleY(lowPrice),
          highPrice,
          lowPrice,
          ...colors
        });
      }
    }

    return ranges;
  })();

  const tagWidthFor = (text: string) => Math.min(168, Math.max(58, Math.ceil(text.length * 6.5 + 20)));

  const priceTag = (price: number, color: string, label: string, fill = "#191D24", text = `${label} ${formatPrice(price)}`) => {
    const y = scaleY(price);
    const tagWidth = tagWidthFor(text);
    const tagX = width - tagWidth - 8;
    return (
      <g key={`${label}-${price}-tag`}>
        <rect x={tagX} y={y - 12} width={tagWidth} height="24" rx="4" fill={fill} stroke={color} strokeWidth="1" />
        <text x={tagX + tagWidth / 2} y={y + 4} fill={fill === cleanCandleUp ? "#191D24" : "#f8fafc"} fontSize="10" fontWeight="800" textAnchor="middle">{text}</text>
      </g>
    );
  };

  // Right-edge price tags are collected and laid out together so ENTRY/STOP/TP/LAST/CRT
  // labels never stack on top of each other when their prices are close.
  type EdgeTag = { price: number; color: string; fill: string; text: string; key: string };
  const edgeTags: EdgeTag[] = [];
  const registerEdgeTag = (price: number, color: string, label: string, fill = "#191D24", text = `${label} ${formatPrice(price)}`) => {
    edgeTags.push({ price, color, fill, text, key: `${label}-${price}` });
    return null;
  };
  const renderEdgeTags = () => {
    const minGap = 26;
    const laidOut = edgeTags
      .filter((tag, index) => edgeTags.findIndex((item) => item.key === tag.key) === index)
      .map((tag) => ({ ...tag, lineY: scaleY(tag.price), y: Math.min(plotBottom - 12, Math.max(plot.top + 12, scaleY(tag.price))) }))
      .sort((a, b) => a.y - b.y);
    for (let index = 1; index < laidOut.length; index += 1) {
      if (laidOut[index].y - laidOut[index - 1].y < minGap) laidOut[index].y = laidOut[index - 1].y + minGap;
    }
    for (let index = laidOut.length - 1; index >= 0; index -= 1) {
      if (laidOut[index].y > plotBottom - 12) laidOut[index].y = plotBottom - 12;
      if (index < laidOut.length - 1 && laidOut[index + 1].y - laidOut[index].y < minGap) {
        laidOut[index].y = laidOut[index + 1].y - minGap;
      }
    }
    return laidOut.map((tag) => {
      const tagWidth = tagWidthFor(tag.text);
      const tagX = width - tagWidth - 8;
      return (
        <g key={`edge-${tag.key}`}>
          {Math.abs(tag.y - tag.lineY) > 3 && (
            <line x1={plotRight} x2={tagX} y1={tag.lineY} y2={tag.y} stroke={tag.color} strokeWidth="1" opacity="0.55" />
          )}
          <rect x={tagX} y={tag.y - 12} width={tagWidth} height="24" rx="4" fill={tag.fill} stroke={tag.color} strokeWidth="1" />
          <text x={tagX + tagWidth / 2} y={tag.y + 4} fill={tag.fill === cleanCandleUp ? "#191D24" : "#f8fafc"} fontSize="10" fontWeight="800" textAnchor="middle">{tag.text}</text>
        </g>
      );
    });
  };

  const levelLine = (price: number, color: string, label: string, dashed = true, opacity = 1, tagFill = "#111827") => {
    const text = `${label} ${formatPrice(price)}`;
    const tagWidth = tagWidthFor(text);
    const tagX = width - tagWidth - 8;
    registerEdgeTag(price, color, label, tagFill, text);
    return (
      <g key={`${label}-${price}`}>
        <line x1={plot.left} x2={Math.max(plot.left + 30, tagX - 6)} y1={scaleY(price)} y2={scaleY(price)} stroke={color} strokeWidth="1.2" strokeDasharray={dashed ? "4 5" : "0"} opacity={opacity} />
      </g>
    );
  };

  const guideLine = (price: number, color: string, label: string, dashed = true, opacity = 0.55) => {
    const y = scaleY(price);
    return (
      <g key={`${label}-${price}-guide`}>
        <line x1={plot.left} x2={plotRight} y1={y} y2={y} stroke={color} strokeWidth="1" strokeDasharray={dashed ? "3 6" : "0"} opacity={opacity} />
        {label && <text x={plot.left + 8} y={y - 5} fill={color} fontSize="9" fontWeight="800" opacity={opacity + 0.12}>{label}</text>}
      </g>
    );
  };

  const planMarker = (
    price: number,
    color: string,
    fill: string,
    markerX: number,
    kind: "entry" | "stop" | "target"
  ) => {
    const y = scaleY(price);
    return (
      <g key={`${kind}-${price}-marker`}>
        {kind === "entry" && <rect x={markerX - 7} y={y - 7} width="14" height="14" rx="2" fill={fill} stroke={color} strokeWidth="2.2" />}
        {kind === "stop" && (
          <g stroke={color} strokeWidth="2.4" strokeLinecap="round">
            <line x1={markerX - 7} x2={markerX + 7} y1={y - 7} y2={y + 7} />
            <line x1={markerX - 7} x2={markerX + 7} y1={y + 7} y2={y - 7} />
          </g>
        )}
        {kind === "target" && <path d={`M ${markerX} ${y - 8} L ${markerX + 8} ${y} L ${markerX} ${y + 8} L ${markerX - 8} ${y} Z`} fill={fill} stroke={color} strokeWidth="2" />}
      </g>
    );
  };

  const selectedOverlay = (() => {
    if (!selectedIsConfirmationChart || !selectedSignal || !annotations || !latest) return null;

    const anchorX = Math.min(Math.max(xForTime(signalAnchorTime(selectedSignal)), plot.left + 18), plotRight - 18);
    const signalColor = stageColor(selectedSignal);
    const primaryTarget = selectedSignal.plan.targets[0] ?? selectedSignal.plan.entry;
    const rewardTop = Math.max(selectedSignal.plan.entry, primaryTarget);
    const rewardBottom = Math.min(selectedSignal.plan.entry, primaryTarget);
    const riskTop = Math.max(selectedSignal.plan.entry, selectedSignal.plan.stopLoss);
    const riskBottom = Math.min(selectedSignal.plan.entry, selectedSignal.plan.stopLoss);
    const riskYTop = scaleY(riskTop);
    const riskYBottom = scaleY(riskBottom);
    const actualRiskHeight = Math.max(5, riskYBottom - riskYTop);
    const visualRiskHeight = Math.max(52, actualRiskHeight);
    const visualRiskY = Math.max(plot.top, Math.min(plotBottom - visualRiskHeight, riskYTop + actualRiskHeight / 2 - visualRiskHeight / 2));
    const overlayWidth = Math.max(70, plotRight - anchorX);
    const closeReferenceCandle = closeRequirement && closeReqOnChart ? candles[closeRequirement.candleIndex] : undefined;
    const gapLabel = entryGapLabel(selectedSignal);
    const gapText = annotations.fairValueGap?.mitigated ? `${gapLabel} retest` : gapLabel;
    const gapLabelWidth = gapText ? tagWidthFor(gapText) : 68;
    const manualLineColor = "#f8fafc";
    const waitLineY = closeRequirement ? scaleY(closeRequirement.level) : 0;
    const waitLabelX = closeRequirement ? Math.min(plotRight - 168, Math.max(plot.left + 120, anchorX + 24)) : 0;
    const waitLabelY = closeRequirement ? Math.max(plot.top + 22, Math.min(plotBottom - 16, waitLineY - 22)) : 0;
    const decisionText = chartDecisionText(selectedSignal, closeRequirement);

    return (
      <g className="selected-signal-overlay">
        <g className="chart-decision-strip">
          <rect x={plot.left + 10} y={plot.top + 10} width={plotRight - plot.left - 20} height="30" rx="6" fill="rgba(255, 255, 255, 0.72)" stroke={signalColor} strokeWidth="1.2" />
          <text x={plot.left + 24} y={plot.top + 30} fill="#191D24" fontSize="11" fontWeight="900">
            {decisionText}
          </text>
        </g>
        <rect
          x={anchorX}
          y={scaleY(rewardTop)}
          width={overlayWidth}
          height={Math.max(5, scaleY(rewardBottom) - scaleY(rewardTop))}
          fill="rgba(34, 171, 148, 0.09)"
          stroke="rgba(34, 171, 148, 0.28)"
        />
        <rect
          x={anchorX}
          y={visualRiskY}
          width={overlayWidth}
          height={visualRiskHeight}
          fill="rgba(242, 54, 69, 0.1)"
          stroke="rgba(242, 54, 69, 0.28)"
        />
        <text x={anchorX + 8} y={visualRiskY + 15} fill="#fecdd3" fontSize="9" fontWeight="900">
          {selectedSignal.stage === "invalidated" ? "STOP GÖRÜLDÜ" : `1R RISK · ${stopSourceText(selectedSignal)}`}
        </text>
        {selectedSignal.stage === "invalidated" && (
          <g>
            <rect x={plotRight - 266} y={plot.top + 14} width="252" height="48" rx="6" fill="rgba(76, 5, 25, 0.92)" stroke={bear} strokeWidth="1.5" />
            <text x={plotRight - 250} y={plot.top + 34} fill="#fecdd3" fontSize="12" fontWeight="900">INVALIDATED · STOP GÖRÜLDÜ</text>
            <text x={plotRight - 250} y={plot.top + 51} fill="#f8fafc" fontSize="10" fontWeight="800">Bu setup işlem adayı değil. Yeni setup bekle.</text>
          </g>
        )}
        {selectedSignal.stage === "missed" && (
          <g>
            <rect x={plotRight - 246} y={plot.top + 14} width="232" height="48" rx="6" fill="rgba(15, 23, 42, 0.92)" stroke="#64748b" strokeWidth="1.5" />
            <text x={plotRight - 230} y={plot.top + 34} fill="#cbd5e1" fontSize="12" fontWeight="900">MISSED · HEDEF GİTMİŞ</text>
            <text x={plotRight - 230} y={plot.top + 51} fill="#f8fafc" fontSize="10" fontWeight="800">Geç entry kovalanmaz. Yeni model bekle.</text>
          </g>
        )}
        {annotations.fairValueGap && (
          <g>
            <rect
              x={xForCandleIndex(Math.max(0, annotations.fairValueGap.candleIndex - 1))}
              y={scaleY(annotations.fairValueGap.high)}
              width={Math.max(52, xForCandleIndex(annotations.fairValueGap.candleIndex + 18) - xForCandleIndex(Math.max(0, annotations.fairValueGap.candleIndex - 1)))}
              height={Math.max(5, scaleY(annotations.fairValueGap.low) - scaleY(annotations.fairValueGap.high))}
              fill={selectedSignal.direction === "long" ? "rgba(34, 171, 148, 0.2)" : "rgba(242, 54, 69, 0.2)"}
              stroke={selectedSignal.direction === "long" ? bull : bear}
              strokeWidth="1.2"
            />
            <rect x={xForCandleIndex(annotations.fairValueGap.candleIndex)} y={scaleY(annotations.fairValueGap.high) - 18} width={gapLabelWidth} height="18" rx="4" fill="#0f172a" stroke={selectedSignal.direction === "long" ? bull : bear} />
            <text x={xForCandleIndex(annotations.fairValueGap.candleIndex) + gapLabelWidth / 2} y={scaleY(annotations.fairValueGap.high) - 5} fill="#f8fafc" fontSize="10" fontWeight="800" textAnchor="middle">
              {gapText}
            </text>
          </g>
        )}
        {annotations.sweep && (
          <g>
            <line
              x1={plot.left}
              x2={plotRight}
              y1={scaleY(annotations.sweep.level)}
              y2={scaleY(annotations.sweep.level)}
              stroke={manualLineColor}
              strokeWidth="1.4"
              strokeDasharray="2 4"
              opacity={selectedIsConfirmationChart ? 0.58 : 0.72}
            />
            <circle cx={xForCandleIndex(annotations.sweep.candleIndex)} cy={scaleY(annotations.sweep.level)} r="5" fill="#f59e0b" stroke="#06080c" strokeWidth="2" />
            <text x={Math.min(plotRight - 8, xForCandleIndex(annotations.sweep.candleIndex) + 18)} y={scaleY(annotations.sweep.level) - 8} fill="#f59e0b" fontSize="9" fontWeight="900">
              sweep
            </text>
            <text x={plotRight - 12} y={scaleY(annotations.sweep.level) - 8} fill={manualLineColor} fontSize="11" fontWeight="800" textAnchor="end">
              {annotations.sweep.side === "buy-side" ? "liq alımı" : "liq satımı"}
            </text>
          </g>
        )}
        {annotations.smtDivergence && (
          <g>
            <line
              x1={Math.max(plot.left, xForCandleIndex(annotations.smtDivergence.candleIndex) - 30)}
              x2={Math.min(plotRight, xForCandleIndex(annotations.smtDivergence.candleIndex) + 70)}
              y1={scaleY(annotations.smtDivergence.localExtreme)}
              y2={scaleY(annotations.smtDivergence.localExtreme)}
              stroke="#fbbf24"
              strokeWidth="1.4"
              strokeDasharray="2 4"
              opacity="0.78"
            />
            <rect
              x={Math.min(plotRight - 92, xForCandleIndex(annotations.smtDivergence.candleIndex) + 12)}
              y={scaleY(annotations.smtDivergence.localExtreme) + (selectedSignal.direction === "short" ? -28 : 10)}
              width="88"
              height="18"
              rx="4"
              fill="rgba(59, 37, 8, 0.92)"
              stroke="#fbbf24"
              strokeWidth="1"
            />
            <text
              x={Math.min(plotRight - 92, xForCandleIndex(annotations.smtDivergence.candleIndex) + 12) + 44}
              y={scaleY(annotations.smtDivergence.localExtreme) + (selectedSignal.direction === "short" ? -15 : 23)}
              fill="#fde68a"
              fontSize="9"
              fontWeight="900"
              textAnchor="middle"
            >
              SMT vs {annotations.smtDivergence.partner}
            </text>
          </g>
        )}
        {annotations.marketStructureShift && (
          <g>
            <line
              x1={xForCandleIndex(Math.max(0, annotations.marketStructureShift.candleIndex - 10))}
              x2={xForCandleIndex(annotations.marketStructureShift.candleIndex + 10)}
              y1={scaleY(annotations.marketStructureShift.level)}
              y2={scaleY(annotations.marketStructureShift.level)}
              stroke="#a78bfa"
              strokeWidth="2"
            />
            <rect x={xForCandleIndex(annotations.marketStructureShift.candleIndex) - 22} y={scaleY(annotations.marketStructureShift.level) - 25} width="44" height="18" rx="4" fill="#1e1b4b" stroke="#a78bfa" />
            <text x={xForCandleIndex(annotations.marketStructureShift.candleIndex)} y={scaleY(annotations.marketStructureShift.level) - 12} fill="#ddd6fe" fontSize="10" fontWeight="800" textAnchor="middle">ChoCH</text>
          </g>
        )}
        {closeRequirement && (
          <g className="close-confirmation-level">
            {closeReferenceCandle && (
              <g>
                <rect
                  x={xForCandleIndex(closeRequirement.candleIndex) - candleWidth / 2 - 6}
                  y={scaleY(closeReferenceCandle.high) - 6}
                  width={candleWidth + 12}
                  height={Math.max(14, scaleY(closeReferenceCandle.low) - scaleY(closeReferenceCandle.high) + 12)}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  opacity="0.9"
                />
                <text x={xForCandleIndex(closeRequirement.candleIndex)} y={Math.max(plot.top + 12, scaleY(closeReferenceCandle.high) - 10)} fill="#fbbf24" fontSize="9" fontWeight="900" textAnchor="middle">
                  referans mum
                </text>
              </g>
            )}
            <line
              x1={plot.left}
              x2={plotRight}
              y1={waitLineY}
              y2={waitLineY}
              stroke="#f59e0b"
              strokeWidth="1.35"
              strokeDasharray="5 6"
              opacity="0.95"
            />
            <rect x={waitLabelX} y={waitLabelY - 17} width="216" height="34" rx="4" fill="rgba(15, 23, 42, 0.9)" stroke="#f59e0b" strokeWidth="1.1" />
            <text x={waitLabelX + 108} y={waitLabelY - 3} fill="#f8fafc" fontSize="10" fontWeight="900" textAnchor="middle">
              kapanış onayı · {closeRequirement.timeframe} {closeRequirement.side === "above" ? ">" : "<"} {formatPrice(closeRequirement.level)}
            </text>
            <text x={waitLabelX + 108} y={waitLabelY + 11} fill="#fbbf24" fontSize="9" fontWeight="800" textAnchor="middle">
              {closeRequirement.reference === "last-closed-high" ? "Son mum high kırılırsa onay" : "Son mum low kırılırsa onay"}
            </text>
          </g>
        )}
        {annotations.displacement && (
          <rect
            x={xForCandleIndex(annotations.displacement.candleIndex) - candleWidth / 2 - 4}
            y={scaleY(candles[annotations.displacement.candleIndex]?.high ?? selectedSignal.plan.entry)}
            width={candleWidth + 8}
            height={Math.max(10, scaleY(candles[annotations.displacement.candleIndex]?.low ?? selectedSignal.plan.entry) - scaleY(candles[annotations.displacement.candleIndex]?.high ?? selectedSignal.plan.entry))}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2"
          />
        )}
        {levelLine(selectedSignal.plan.entry, "#38bdf8", "ENTRY", false, 1, "#0c4a6e")}
        {levelLine(selectedSignal.plan.stopLoss, bear, selectedSignal.stage === "invalidated" ? "STOP HIT" : "STOP", false, 1, "#4c0519")}
        {selectedSignal.plan.targets.map((target, index) => levelLine(target, bull, index === 0 ? "EQ/TP1" : "DOL/TP2", index > 0, 1, "#064e3b"))}
        <g className="trade-execution-markers">
          {planMarker(selectedSignal.plan.entry, "#38bdf8", "#0c4a6e", anchorX, "entry")}
          {planMarker(selectedSignal.plan.stopLoss, bear, "#4c0519", anchorX, "stop")}
          {selectedSignal.plan.targets.slice(0, 2).map((target, index) =>
            planMarker(target, index === 0 ? bull : "#14b8a6", "#064e3b", anchorX, "target")
          )}
        </g>
        {selectedSignal.stage !== "ready" && selectedSignal.stage !== "watch" && (
          <line x1={plot.left} x2={plotRight} y1={scaleY(selectedSignal.plan.entry)} y2={scaleY(selectedSignal.plan.stopLoss)} stroke={signalColor} strokeWidth="2" strokeDasharray="7 8" opacity="0.72" />
        )}
      </g>
    );
  })();

  const higherTimeframePlanOverlay = selectedIsHigherTimeframe && selectedSignal ? (() => {
    const chipWidth = 150;
    const chipX = width - chipWidth - 8;
    const lineX1 = plot.left + 12;
    const lineX2 = plotRight - 16;
    const anchorDotX = chipX - 22;
    const topLimit = plot.top + 14;
    const bottomLimit = plotBottom - 14;
    const minGap = 27;
    const levels = [
      {
        key: "entry",
        price: selectedSignal.plan.entry,
        label: "HTF GİRİŞ",
        color: "#38bdf8",
        fill: "rgba(12, 74, 110, 0.9)",
        dash: "0"
      },
      {
        key: "stop",
        price: selectedSignal.plan.stopLoss,
        label: selectedSignal.stage === "invalidated" ? "HTF STOP HIT" : "HTF STOP",
        color: bear,
        fill: "rgba(76, 5, 25, 0.92)",
        dash: "0"
      },
      ...selectedSignal.plan.targets.slice(0, 2).map((target, index) => ({
        key: `target-${index}`,
        price: target,
        label: index === 0 ? "HTF EQ/TP1" : "HTF DOL/TP2",
        color: index === 0 ? bull : "#14b8a6",
        fill: "rgba(6, 78, 59, 0.9)",
        dash: index === 0 ? "4 5" : "2 6"
      }))
    ]
      .map((level) => ({
        ...level,
        lineY: scaleY(level.price),
        labelY: Math.min(bottomLimit, Math.max(topLimit, scaleY(level.price)))
      }))
      .sort((a, b) => a.labelY - b.labelY);

    for (let index = 1; index < levels.length; index += 1) {
      if (levels[index].labelY - levels[index - 1].labelY < minGap) {
        levels[index].labelY = levels[index - 1].labelY + minGap;
      }
    }
    for (let index = levels.length - 1; index >= 0; index -= 1) {
      if (levels[index].labelY > bottomLimit) levels[index].labelY = bottomLimit;
      if (index < levels.length - 1 && levels[index + 1].labelY - levels[index].labelY < minGap) {
        levels[index].labelY = levels[index + 1].labelY - minGap;
      }
    }

    return (
      <g className="higher-timeframe-plan-overlay">
        {levels.map((level) => {
          const connectorNeeded = Math.abs(level.labelY - level.lineY) > 2;
          return (
            <g key={`htf-plan-${level.key}-${level.price}`}>
              <line x1={lineX1} x2={lineX2} y1={level.lineY} y2={level.lineY} stroke={level.color} strokeWidth="1.35" strokeDasharray={level.dash} opacity="0.82" />
              <polyline
                points={connectorNeeded
                  ? `${lineX2},${level.lineY} ${anchorDotX},${level.lineY} ${chipX - 10},${level.labelY}`
                  : `${lineX2},${level.lineY} ${chipX - 10},${level.labelY}`}
                fill="none"
                stroke={level.color}
                strokeWidth="1.1"
                opacity="0.68"
              />
              <circle cx={anchorDotX} cy={level.lineY} r="4" fill={level.color} stroke={chartBackground} strokeWidth="1.6" />
              <rect x={chipX} y={level.labelY - 11} width={chipWidth} height="22" rx="5" fill={level.fill} stroke={level.color} strokeWidth="1.1" />
              <text x={chipX + chipWidth / 2} y={level.labelY + 4} fill="#f8fafc" fontSize="9" fontWeight="900" textAnchor="middle">
                {level.label} {formatPrice(level.price)}
              </text>
            </g>
          );
        })}
      </g>
    );
  })() : null;

  const markers = showSignalMarkers && first && latest
    ? (() => {
        // Multi-anchor CRT signals share the same anchor candle: stack their chips instead of
        // stamping them on top of each other, and keep them clear of the right-edge price tags.
        const items = signals
          .filter((signal) => signal.context.symbol === context?.symbol)
          .filter((signal) => signal.id !== selectedSignal?.id)
          .filter((signal) => {
            const focus = focusChartOnSignal(signal, 0);
            return focus.to >= first.time && focus.from <= latest.time;
          })
          .map((signal) => {
            const anchorTf = signal.crtAnchor?.rangeTf;
            const label = anchorTf ? `${signal.stage.toUpperCase()} ${anchorTf.toUpperCase()}` : signal.stage.toUpperCase();
            const candle = nearestCandle(visible, signalAnchorTime(signal));
            const x = Math.min(xForTime(signalAnchorTime(signal)), plotRight - 40);
            const y = signal.direction === "long" ? scaleY(candle.low) + 16 : scaleY(candle.high) - 16;
            return { signal, label, x, y: Math.max(plot.top + 26, Math.min(plotBottom - 14, y)) };
          })
          .sort((a, b) => a.x - b.x || a.y - b.y);
        for (let index = 1; index < items.length; index += 1) {
          for (let prev = 0; prev < index; prev += 1) {
            if (Math.abs(items[index].x - items[prev].x) < 76 && Math.abs(items[index].y - items[prev].y) < 24) {
              items[index].y = items[prev].y + 26;
            }
          }
          items[index].y = Math.min(plotBottom - 14, items[index].y);
        }
        return items.map(({ signal, label, x, y }) => {
          const color = stageColor(signal);
          const chipWidth = Math.max(56, label.length * 7 + 14);
          return (
            <g
              key={signal.id}
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onSelectSignal?.(signal);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelectSignal?.(signal);
              }}
              className={selectedSignal?.id === signal.id ? "signal-marker selected" : "signal-marker"}
            >
              <rect x={x - chipWidth / 2} y={y - 12} width={chipWidth} height="22" rx="5" fill="#0f172a" stroke={color} strokeWidth="1.2" />
              <text x={x} y={y + 3} fill={color} fontSize="10" fontWeight="800" textAnchor="middle">{label}</text>
            </g>
          );
        });
      })()
    : null;

  const hovered = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < visible.length ? visible[hoverIndex] : null;
  const hudCandle = hovered ?? latest;
  const hudChangePct = hudCandle.open !== 0 ? ((hudCandle.close - hudCandle.open) / hudCandle.open) * 100 : 0;
  const handleChartMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const chartX = ((event.clientX - rect.left) / rect.width) * width;
    if (chartX < plot.left || chartX > plotRight) {
      setHoverIndex(null);
      return;
    }
    const index = Math.round((chartX - plot.left - step / 2) / step);
    setHoverIndex(index >= 0 && index < visible.length ? index : null);
  };

  return (
    <figure className={selectedIsConfirmationChart ? "chart-panel tradingview-chart selected" : "chart-panel tradingview-chart"}>
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title} onMouseMove={handleChartMove} onMouseLeave={() => setHoverIndex(null)}>
        <rect width={width} height={height} rx="8" fill={chartBackground} />
        <rect x={plot.left} y={plot.top} width={plotRight - plot.left} height={plotBottom - plot.top} fill={plotBackground} />
        <rect x={plot.left} y={plot.top} width={plotRight - plot.left} height={plotBottom - plot.top} fill="none" stroke="rgba(76, 91, 110, 0.46)" strokeWidth="1" />
        {showPremiumDiscountBand && range && (
          <>
            <rect x={plot.left} y={scaleY(range.high)} width={plotRight - plot.left} height={Math.max(0, scaleY(range.midpoint) - scaleY(range.high))} fill="rgba(242, 54, 69, 0.045)" />
            <rect x={plot.left} y={scaleY(range.midpoint)} width={plotRight - plot.left} height={Math.max(0, scaleY(range.low) - scaleY(range.midpoint))} fill="rgba(34, 171, 148, 0.045)" />
          </>
        )}
        {sessionRanges.map((session) => (
          <g key={`${session.key}-box`}>
            <rect
              x={session.x1}
              y={session.yHigh}
              width={Math.max(1, session.x2 - session.x1)}
              height={Math.max(2, session.yLow - session.yHigh)}
              fill={session.fill}
              stroke={session.stroke}
              strokeWidth="1"
            />
            <text
              x={session.x1 + (session.x2 - session.x1) / 2}
              y={Math.max(session.yHigh + 28, Math.min(session.yLow - 14, session.yHigh + (session.yLow - session.yHigh) / 2 + 10))}
              fill={session.text}
              fontSize={session.x2 - session.x1 > 110 ? "26" : "17"}
              fontWeight="900"
              textAnchor="middle"
              opacity="0.34"
            >
              {session.title}
            </text>
          </g>
        ))}
        {priceTicks(high, low, 13).filter((_, index) => index % 2 === 1).map((price) => (
          <line key={`minor-grid-${price}`} x1={plot.left} x2={plotRight} y1={scaleY(price)} y2={scaleY(price)} stroke={minorGrid} strokeWidth="1" />
        ))}
        {priceTicks(high, low).map((price) => (
          <g key={`grid-${price}`}>
            <line x1={plot.left} x2={plotRight} y1={scaleY(price)} y2={scaleY(price)} stroke={gridColor} strokeWidth="1" />
            <text x={plotRight + 10} y={scaleY(price) + 4} fill={axisColor} fontSize="10">{formatPrice(price)}</text>
          </g>
        ))}
        {timeIndexes.map((index) => (
          <g key={`time-${visible[index]?.time}`}>
            <line x1={xAtVisibleIndex(index)} x2={xAtVisibleIndex(index)} y1={plot.top} y2={plotBottom} stroke={gridColor} strokeWidth="1" />
            <text x={xAtVisibleIndex(index)} y={height - 14} fill={axisColor} fontSize="10" textAnchor="middle">{timeLabel(visible[index].time, mode)}</text>
          </g>
        ))}
        <line x1={plotRight} x2={plotRight} y1={plot.top} y2={plotBottom} stroke={axisLineColor} />
        <line x1={plot.left} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke={axisLineColor} />
        {sessionRanges.map((session) => {
          const highLabelY = Math.max(plot.top + 13, session.yHigh - 5);
          const lowLabelY = Math.min(plotBottom - 4, session.yLow + 13);
          const labelX = Math.min(session.x2 - 8, Math.max(session.x1 + 28, session.x1 + (session.x2 - session.x1) * 0.72));

          return (
            <g key={`${session.key}-levels`}>
              <line x1={session.x1} x2={session.x2} y1={session.yHigh} y2={session.yHigh} stroke={session.stroke} strokeWidth="1" opacity="0.52" />
              <line x1={session.x1} x2={session.x2} y1={session.yLow} y2={session.yLow} stroke={session.stroke} strokeWidth="1" opacity="0.52" />
              <text x={labelX} y={highLabelY} fill={session.text} fontSize="9" fontWeight="800" textAnchor="middle" opacity="0.8">
                {session.short}.H
              </text>
              <text x={labelX} y={lowLabelY} fill={session.text} fontSize="9" fontWeight="800" textAnchor="middle" opacity="0.8">
                {session.short}.L
              </text>
            </g>
          );
        })}
        {mode !== "context" && range && contextLevels.includes(range.high) && (selectedSignal ? guideLine(range.high, "#64748b", "", true, 0.24) : levelLine(range.high, "#94a3b8", "CRT H", true, 0.74))}
        {mode !== "context" && range && contextLevels.includes(range.midpoint) && (selectedSignal ? guideLine(range.midpoint, "#64748b", "CRT EQ", true, 0.28) : levelLine(range.midpoint, "#64748b", "CRT EQ", true, 0.78))}
        {mode !== "context" && range && contextLevels.includes(range.low) && (selectedSignal ? guideLine(range.low, "#64748b", "", true, 0.24) : levelLine(range.low, "#94a3b8", "CRT L", true, 0.74))}
        {!selectedSignal && visibleLiquidity.map((pool) => levelLine(pool.level, pool.side === "buy-side" ? "#7B5A16" : "#1D5C73", pool.side === "buy-side" ? "BSL" : "SSL", true, 0.5, pool.side === "buy-side" ? "#3b2508" : "#082f49"))}
        {visible.map((candle, index) => {
          const centerX = snap(xAtVisibleIndex(index));
          const x = Math.round(centerX - candleWidth / 2);
          const up = candle.close >= candle.open;
          const color = up ? cleanCandleUp : cleanCandleDown;
          const wickColor = up ? cleanCandleWick : cleanCandleDown;
          const bodyStroke = up ? cleanCandleUpStroke : cleanCandleDownStroke;
          const openY = scaleY(candle.open);
          const closeY = scaleY(candle.close);
          const rawBodyHeight = Math.abs(openY - closeY);
          const bodyHeight = Math.max(2.4, rawBodyHeight);
          const bodyTop = rawBodyHeight < 2.4 ? (openY + closeY) / 2 - bodyHeight / 2 : Math.min(openY, closeY);
          const opacity = selectedSignal && !selectedIsConfirmationChart ? 0.78 : 1;
          return (
            <g key={candle.time}>
              <line
                x1={centerX}
                x2={centerX}
                y1={snap(scaleY(candle.high))}
                y2={snap(scaleY(candle.low))}
                stroke={wickColor}
                strokeWidth={Math.max(1, Math.min(1.45, candleWidth * 0.16))}
                opacity={opacity}
              />
              <rect
                x={x}
                y={bodyTop}
                width={candleWidth}
                height={bodyHeight}
                rx="0"
                fill={color}
                stroke={bodyStroke}
                strokeWidth={up ? "1.05" : "0.8"}
                opacity={opacity}
              />
            </g>
          );
        })}
        {range && visible.length >= 2 && (mode === "context" || (mode === "daily" && selectedSignal?.crtAnchor)) && (() => {
          // TradingView-style CRT structure: full-width range band with H/EQ/L lines,
          // the range candle and the live manipulation candle outlined — readable at a glance.
          // Locate the actual range candle by matching its extremes (raid persistence means it
          // is not always the second-to-last bar); no exact match on this TF -> band only.
          const matched = visible.findIndex((candle) => candle.high === range.high && candle.low === range.low);
          const rangeIndex = matched >= 0 ? matched : visible.length - 2;
          const rangeCandle = visible[rangeIndex];
          const liveCandle = visible[Math.min(rangeIndex + 1, visible.length - 1)];
          const rangeX = xAtVisibleIndex(rangeIndex);
          const liveX = xAtVisibleIndex(Math.min(rangeIndex + 1, visible.length - 1));
          const yHigh = scaleY(range.high);
          const yLow = scaleY(range.low);
          const yEq = scaleY(range.midpoint);
          return (
            <g className="crt-range-structure">
              <rect x={plot.left} y={yHigh} width={plotRight - plot.left} height={Math.max(2, yLow - yHigh)} fill="rgba(124, 58, 237, 0.05)" />
              <line x1={plot.left} x2={plotRight} y1={yHigh} y2={yHigh} stroke="#7c3aed" strokeWidth="1.4" opacity="0.8" />
              <line x1={plot.left} x2={plotRight} y1={yLow} y2={yLow} stroke="#7c3aed" strokeWidth="1.4" opacity="0.8" />
              <line x1={plot.left} x2={plotRight} y1={yEq} y2={yEq} stroke="#7c3aed" strokeWidth="1" strokeDasharray="4 5" opacity="0.55" />
              <text x={plot.left + 8} y={yHigh + 15} fill="#7c3aed" fontSize="11" fontWeight="900" opacity="0.9">{`CRT RANGE${selectedSignal?.crtAnchor ? ` (${selectedSignal.crtAnchor.rangeTf.toUpperCase()} mum)` : " (4H mum)"}`}</text>
              {matched >= 0 && (
                <>
                  <rect
                    x={rangeX - candleWidth / 2 - 4}
                    y={scaleY(rangeCandle.high) - 4}
                    width={candleWidth + 8}
                    height={Math.max(12, scaleY(rangeCandle.low) - scaleY(rangeCandle.high) + 8)}
                    fill="none"
                    stroke="#7c3aed"
                    strokeWidth="1.8"
                  />
                  <text x={rangeX} y={Math.max(plot.top + 12, scaleY(rangeCandle.high) - 8)} fill="#7c3aed" fontSize="10" fontWeight="900" textAnchor="middle">R</text>
                  <rect
                    x={liveX - candleWidth / 2 - 4}
                    y={scaleY(liveCandle.high) - 4}
                    width={candleWidth + 8}
                    height={Math.max(12, scaleY(liveCandle.low) - scaleY(liveCandle.high) + 8)}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="1.8"
                  />
                  <text x={liveX} y={Math.max(plot.top + 12, scaleY(liveCandle.high) - 8)} fill="#b45309" fontSize="10" fontWeight="900" textAnchor="middle">M</text>
                </>
              )}
              {matched >= 0 && (
                <>
                  {registerEdgeTag(range.high, "#7c3aed", "CRT H", "#2e1065")}
                  {registerEdgeTag(range.midpoint, "#7c3aed", "CRT EQ", "#2e1065")}
                  {registerEdgeTag(range.low, "#7c3aed", "CRT L", "#2e1065")}
                </>
              )}
            </g>
          );
        })()}
        {(mode === "daily" || mode === "context") && context && context.crt.selectedBias.drawSide !== "none"
          && context.crt.selectedBias.drawLevel >= low && context.crt.selectedBias.drawLevel <= high
          && levelLine(context.crt.selectedBias.drawLevel, "#7c3aed", "DOL", true, 0.85, "#2e1065")}
        <line x1={plot.left} x2={plotRight} y1={scaleY(latest.close)} y2={scaleY(latest.close)} stroke={lastPriceColor} strokeWidth="1" strokeDasharray="2 5" opacity="0.78" />
        {!selectedIsHigherTimeframe && registerEdgeTag(latest.close, lastPriceColor, "LAST", latest.close >= latest.open ? cleanCandleUp : cleanCandleDown, formatPrice(latest.close))}
        {markers}
        {selectedOverlay}
        {higherTimeframePlanOverlay}
        {renderEdgeTags()}
        {hovered && hoverIndex !== null && (
          <g pointerEvents="none">
            <line
              x1={snap(xAtVisibleIndex(hoverIndex))}
              x2={snap(xAtVisibleIndex(hoverIndex))}
              y1={plot.top}
              y2={plotBottom}
              stroke="#191D24"
              strokeWidth="1"
              strokeDasharray="3 4"
              opacity="0.4"
            />
            <line
              x1={plot.left}
              x2={plotRight}
              y1={snap(scaleY(hovered.close))}
              y2={snap(scaleY(hovered.close))}
              stroke="#191D24"
              strokeWidth="1"
              strokeDasharray="3 4"
              opacity="0.4"
            />
            {priceTag(hovered.close, "#191D24", "", "#E8E5E0", formatPrice(hovered.close))}
            <rect x={Math.max(plot.left, Math.min(plotRight - 84, xAtVisibleIndex(hoverIndex) - 42))} y={plotBottom + 3} width="84" height="17" rx="3" fill="#191D24" />
            <text x={Math.max(plot.left + 42, Math.min(plotRight - 42, xAtVisibleIndex(hoverIndex)))} y={plotBottom + 15} fill="#E8E5E0" fontSize="10" fontWeight="700" textAnchor="middle">
              {timeLabel(hovered.time, mode)}
            </text>
          </g>
        )}
        <g className="chart-hud compact">
          <rect x={plot.left + 8} y="14" width={plotRight - plot.left - 16} height="25" rx="4" fill={hudFill} stroke="rgba(25, 29, 36, 0.16)" />
          <text x={plot.left + 18} y="31" fill={hudText} fontSize="11" fontWeight="900">
            {title} · O {formatPrice(hudCandle.open)} H {formatPrice(hudCandle.high)} L {formatPrice(hudCandle.low)} C {formatPrice(hudCandle.close)}
            {" "}
            <tspan fill={hudCandle.close >= hudCandle.open ? "#0a7d5c" : "#c22f3d"}>
              {`${hudChangePct >= 0 ? "+" : ""}${hudChangePct.toFixed(2)}%`}
            </tspan>
            {hovered ? <tspan fill="#555A62">{` · ${timeLabel(hovered.time, mode)}`}</tspan> : null}
          </text>
          <text x={plotRight - 12} y="31" fill={selectedSignal ? stageColor(selectedSignal) : "#555A62"} fontSize="11" fontWeight="900" textAnchor="end">
            {selectedSignal ? setupStatus(selectedSignal) : `PD ${context?.premiumDiscount.zone ?? "-"}`}
          </text>
        </g>
      </svg>
    </figure>
  );
}
