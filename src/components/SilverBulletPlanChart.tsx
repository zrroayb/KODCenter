import { formatPrice } from "../lib/ict/format";
import type { SilverBulletSetup } from "../lib/strategies/silverBullet/types";

// "Ne bekliyoruz" haritası: 09:00 range → sweep → reclaim → displacement → FVG girişi → hedef.
// Bir mum grafiği değil; aşamaların çoğu henüz gerçekleşmemiş beklenti olduğu için
// beklenen fiyat yolculuğunu şematik olarak çizer (gerçekleşen aşamalar dolu, beklenenler kesik).

const STAGES = ["Range", "Sweep", "Reclaim", "Displ.", "Giriş", "Hedef"] as const;

const bull = "#089981";
const bear = "#f23645";
const violet = "#8b7ff0";
const grid = "rgba(148, 163, 184, 0.28)";
const faint = "rgba(148, 163, 184, 0.5)";
const ink = "#e7ecf3";
const dim = "#93a1b5";

const width = 660;
const height = 300;
const plot = { left: 14, right: 96, top: 18, bottom: 40 };
const plotRight = width - plot.right;
const plotBottom = height - plot.bottom;

type Bias = "bearish" | "bullish" | "none";

function biasOf(setup: SilverBulletSetup): Bias {
  if (setup.setupModel?.includes("HIGH_SWEEP")) return "bearish";
  if (setup.setupModel?.includes("LOW_SWEEP")) return "bullish";
  if (setup.direction === "short") return "bearish";
  if (setup.direction === "long") return "bullish";
  if (setup.sweep?.side === "HIGH") return "bearish";
  if (setup.sweep?.side === "LOW") return "bullish";
  return "none";
}

// Yaşam döngüsünden şu an hangi aşamada beklendiğini çıkar (0..5).
function lifecycleStage(status: SilverBulletSetup["lifecycleStatus"]): number | null {
  switch (status) {
    case "PRE_REFERENCE":
    case "REFERENCE_BUILDING":
    case "REFERENCE_LOCKED":
      return 0;
    case "WINDOW_OPEN":
    case "WAITING_FOR_SWEEP":
      return 1;
    case "HIGH_SWEPT":
    case "LOW_SWEPT":
    case "WAITING_FOR_RECLAIM":
      return 2;
    case "RECLAIM_CONFIRMED":
    case "WAITING_FOR_DISPLACEMENT":
    case "WAITING_FOR_STRUCTURE_SHIFT":
      return 3;
    case "WAITING_FOR_ENTRY_ARRAY":
    case "ORDER_PENDING":
      return 4;
    case "ENTRY_FILLED":
    case "ACTIVE":
    case "TARGET_1_REACHED":
    case "TARGET_2_REACHED":
    case "COMPLETED":
      return 5;
    default:
      return null; // NO_TRADE / EXPIRED / LATE / INVALIDATED / STOPPED
  }
}

// Veriden fiilen ulaşılmış aşamayı çıkar (terminal durumlarda ne kadar ilerlediğini gösterir).
function reachedStage(setup: SilverBulletSetup): number {
  let reached = 0;
  if (setup.sweep) reached = Math.max(reached, 2);
  if (setup.mss || setup.cisd || setup.displacement) reached = Math.max(reached, 3);
  if (setup.entryArray || setup.plan) reached = Math.max(reached, 4);
  if (setup.plan?.entryFilledUtc) reached = Math.max(reached, 5);
  const life = lifecycleStage(setup.lifecycleStatus);
  return life === null ? reached : Math.max(reached, life);
}

export function SilverBulletPlanChart({ setup }: { setup: SilverBulletSetup }) {
  const { high, low, midpoint, close, rangeSize } = setup.referenceRange;
  const span = Math.max(rangeSize, Math.abs(high - low) || high * 0.001 || 0.0001);
  const bias = biasOf(setup);
  const reached = reachedStage(setup);
  const isTerminal = lifecycleStage(setup.lifecycleStatus) === null;
  const nextStage = isTerminal ? null : Math.min(reached + (reached === 0 ? 1 : 1), 5);

  const sweepPrice = setup.sweep?.extremePrice ?? (bias === "bearish" ? high + span * 0.18 : bias === "bullish" ? low - span * 0.18 : midpoint);
  const entryPrice = setup.plan?.entry ?? (setup.entryArray ? (setup.entryArray.top + setup.entryArray.bottom) / 2 : bias === "bearish" ? high - span * 0.32 : bias === "bullish" ? low + span * 0.32 : midpoint);
  const targetPrice = setup.plan?.targets[setup.plan.targets.length - 1] ?? (bias === "bearish" ? low : bias === "bullish" ? high : midpoint);
  const stopPrice = setup.plan?.stopLoss;

  // Aşama başına beklenen fiyat (y ekseni fiyat, x ekseni aşama).
  const pathPrices: number[] = [
    close,
    bias === "none" ? midpoint : sweepPrice,
    bias === "bearish" ? high - span * 0.06 : bias === "bullish" ? low + span * 0.06 : midpoint,
    midpoint,
    entryPrice,
    targetPrice
  ];

  const domainValues = [high, low, midpoint, close, sweepPrice, entryPrice, targetPrice, ...(stopPrice !== undefined ? [stopPrice] : []), ...(setup.entryArray ? [setup.entryArray.top, setup.entryArray.bottom] : [])];
  let min = Math.min(...domainValues);
  let max = Math.max(...domainValues);
  if (max === min) { max += span || 1; min -= span || 1; }
  const pad = (max - min) * 0.1;
  min -= pad;
  max += pad;

  const scaleY = (price: number) => plot.top + (1 - (price - min) / (max - min)) * (plotBottom - plot.top);
  const stageX = (i: number) => plot.left + 24 + (i / (STAGES.length - 1)) * (plotRight - plot.left - 34);

  const dirColor = bias === "bearish" ? bear : bias === "bullish" ? bull : violet;

  const levelLines: Array<{ price: number; label: string; color: string }> = [
    { price: high, label: "H", color: grid },
    { price: midpoint, label: "EQ", color: faint },
    { price: low, label: "L", color: grid }
  ];

  return (
    <figure className="sb-plan-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${setup.symbol} Silver Bullet plan haritası`}>
        <rect x="0" y="0" width={width} height={height} rx="10" fill="#0f131c" />

        {/* 09:00 referans range kutusu */}
        <rect
          x={plot.left}
          y={scaleY(high)}
          width={plotRight - plot.left}
          height={Math.max(2, scaleY(low) - scaleY(high))}
          fill="rgba(139, 127, 240, 0.08)"
          stroke="rgba(139, 127, 240, 0.28)"
          strokeWidth="1"
        />

        {/* High / EQ / Low seviye çizgileri + sağda fiyat */}
        {levelLines.map((level) => (
          <g key={level.label}>
            <line x1={plot.left} x2={plotRight} y1={scaleY(level.price)} y2={scaleY(level.price)} stroke={level.color} strokeWidth="1" strokeDasharray={level.label === "EQ" ? "2 4" : undefined} />
            <text x={plotRight + 6} y={scaleY(level.price) + 3} fontSize="11" fill={dim}>{level.label}</text>
            <text x={plotRight + 26} y={scaleY(level.price) + 3} fontSize="11" fill={ink} fontWeight="600">{formatPrice(level.price)}</text>
          </g>
        ))}

        {/* Stop ve hedef seviyeleri (plan varsa) */}
        {stopPrice !== undefined && (
          <>
            <line x1={stageX(3)} x2={plotRight} y1={scaleY(stopPrice)} y2={scaleY(stopPrice)} stroke={bear} strokeWidth="1" strokeDasharray="4 3" opacity="0.8" />
            <text x={plotRight + 6} y={scaleY(stopPrice) + 3} fontSize="10" fill={bear} fontWeight="600">SL</text>
          </>
        )}
        {setup.plan?.targets.map((target, i) => (
          <g key={`tp-${i}`}>
            <line x1={stageX(4)} x2={plotRight} y1={scaleY(target)} y2={scaleY(target)} stroke={bull} strokeWidth="1" strokeDasharray="4 3" opacity="0.8" />
            <text x={plotRight + 6} y={scaleY(target) + 3} fontSize="10" fill={bull} fontWeight="600">TP{i + 1}</text>
          </g>
        ))}

        {/* FVG giriş bölgesi */}
        {setup.entryArray && (
          <rect
            x={stageX(4) - 10}
            y={scaleY(setup.entryArray.top)}
            width={plotRight - (stageX(4) - 10)}
            height={Math.max(2, scaleY(setup.entryArray.bottom) - scaleY(setup.entryArray.top))}
            fill="rgba(139, 127, 240, 0.16)"
            stroke={violet}
            strokeWidth="1"
          />
        )}

        {/* Beklenen fiyat yolculuğu — dolu (gerçekleşen) + kesik (beklenen) */}
        {bias !== "none" && pathPrices.slice(0, -1).map((price, i) => {
          const done = i < reached;
          return (
            <line
              key={`seg-${i}`}
              x1={stageX(i)}
              y1={scaleY(price)}
              x2={stageX(i + 1)}
              y2={scaleY(pathPrices[i + 1])}
              stroke={done ? dirColor : faint}
              strokeWidth={done ? 2.4 : 1.6}
              strokeDasharray={done ? undefined : "5 4"}
              strokeLinecap="round"
            />
          );
        })}

        {/* Aşama noktaları */}
        {bias !== "none" && pathPrices.map((price, i) => {
          const done = i <= reached;
          const isNext = i === nextStage;
          return (
            <circle
              key={`pt-${i}`}
              cx={stageX(i)}
              cy={scaleY(price)}
              r={isNext ? 5.5 : 4}
              fill={done ? dirColor : "#0f131c"}
              stroke={isNext ? "#fff" : done ? dirColor : faint}
              strokeWidth={isNext ? 2 : 1.4}
            />
          );
        })}

        {/* Yön belirsizse iki taraf da açık: her iki uçta "?" işareti */}
        {bias === "none" && (
          <>
            <text x={stageX(1)} y={scaleY(high) - 8} fontSize="13" fill={dim} textAnchor="middle" fontWeight="700">↑?</text>
            <text x={stageX(1)} y={scaleY(low) + 16} fontSize="13" fill={dim} textAnchor="middle" fontWeight="700">↓?</text>
            <circle cx={stageX(0)} cy={scaleY(close)} r="4" fill={violet} />
          </>
        )}

        {/* Aşama etiketleri; şu an beklenen aşama vurgulu */}
        {STAGES.map((label, i) => {
          const active = i === nextStage && bias !== "none";
          const done = i <= reached && bias !== "none";
          return (
            <text
              key={label}
              x={stageX(i)}
              y={plotBottom + 20}
              fontSize="11"
              textAnchor="middle"
              fill={active ? ink : done ? dim : "rgba(148, 163, 184, 0.55)"}
              fontWeight={active ? 800 : 600}
            >
              {label}
            </text>
          );
        })}
      </svg>
      <figcaption>
        {bias === "none"
          ? "Sweep bekleniyor — iki taraf da açık. 09:00 range'i süpüren tarafa göre yön belirlenecek."
          : isTerminal
            ? `Plan ${reached}/5 aşamaya ulaştı, sonra ${setup.lifecycleStatus === "NO_TRADE" ? "no-trade" : "geçersiz"} oldu.`
            : nextStage !== null
              ? `Şu an beklenen: ${STAGES[nextStage]} — ${bias === "bearish" ? "high sweep sonrası düşüş" : "low sweep sonrası yükseliş"}.`
              : "Plan tamamlandı."}
      </figcaption>
    </figure>
  );
}
