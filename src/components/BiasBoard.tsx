import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { formatPrice } from "../lib/ict/format";
import type { ICTBias, MarketContext, MarketSymbol, StructuralBiasRead } from "../lib/ict/types";

// "Bugün yönüm neresi" şeridi: her sembolün yapısal HTF okuması tek bakışta.
// Kaynak `detectStructuralBias` — yön uydurmaz, yapı çelişkiliyse NÖTR der (Master §8).

const TF_ORDER: Array<{ key: keyof MarketContext["biasDetail"]; label: string }> = [
  { key: "monthly", label: "1M" },
  { key: "weekly", label: "1W" },
  { key: "daily", label: "1D" },
  { key: "h4", label: "4H" },
  { key: "h1", label: "1H" }
];

const PATTERN_LABEL: Record<StructuralBiasRead["pattern"], string> = {
  uptrend: "HH + HL yükseliş",
  downtrend: "LH + LL düşüş",
  expanding: "genişleyen range",
  contracting: "daralan range",
  unclear: "yapı yok"
};

function biasClass(bias: ICTBias): string {
  return bias === "bullish" ? "bullish" : bias === "bearish" ? "bearish" : "neutral";
}

function BiasIcon({ bias }: { bias: ICTBias }) {
  if (bias === "bullish") return <TrendingUp size={14} />;
  if (bias === "bearish") return <TrendingDown size={14} />;
  return <Minus size={14} />;
}

// Gün yönü = 1D yapısal okuma; 4H onu teyit ediyorsa güçlü, çelişiyorsa çatışma denir.
function dayRead(detail: MarketContext["biasDetail"]): { bias: ICTBias; note: string } {
  const daily = detail.daily;
  const h4 = detail.h4;
  if (daily.bias === "neutral") return { bias: "neutral", note: `1D ${PATTERN_LABEL[daily.pattern]} — yön yok` };
  if (h4.bias === "neutral") return { bias: daily.bias, note: `1D ${PATTERN_LABEL[daily.pattern]}, 4H nötr` };
  if (h4.bias === daily.bias) return { bias: daily.bias, note: `1D + 4H aynı yönde (${daily.confidence})` };
  return { bias: daily.bias, note: "1D ile 4H çatışıyor — LTF onayı şart" };
}

export function BiasBoard({
  contexts,
  activeSymbol,
  onSelectSymbol
}: {
  contexts: MarketContext[];
  activeSymbol: MarketSymbol;
  onSelectSymbol: (symbol: MarketSymbol) => void;
}) {
  if (!contexts.length) return null;
  const reads = contexts.map((context) => ({ context, day: dayRead(context.biasDetail) }));
  const bullish = reads.filter((item) => item.day.bias === "bullish").length;
  const bearish = reads.filter((item) => item.day.bias === "bearish").length;
  const neutral = reads.length - bullish - bearish;
  const active = reads.find((item) => item.context.symbol === activeSymbol) ?? reads[0];
  const activeDaily = active.context.biasDetail.daily;
  const invalidation = active.day.bias === "bullish"
    ? activeDaily.protectedLow
    : active.day.bias === "bearish"
      ? activeDaily.protectedHigh
      : undefined;

  return (
    <article className="panel bias-board">
      <header className="bias-board-head">
        <div>
          <span className="eyebrow">Bugünün yönü</span>
          <h2 className={biasClass(active.day.bias)}>
            <BiasIcon bias={active.day.bias} /> {active.context.symbol} · {active.day.bias === "bullish" ? "LONG tarafı" : active.day.bias === "bearish" ? "SHORT tarafı" : "YÖN YOK"}
          </h2>
          <p>{active.day.note}. {activeDaily.reasons[0]}</p>
        </div>
        <div className="bias-board-counts">
          <span className="bullish"><strong>{bullish}</strong> long</span>
          <span className="bearish"><strong>{bearish}</strong> short</span>
          <span className="neutral"><strong>{neutral}</strong> nötr</span>
        </div>
      </header>

      <div className="bias-active-tfs" aria-label={`${active.context.symbol} zaman dilimi yönleri`}>
        {TF_ORDER.map(({ key, label }) => {
          const read = active.context.biasDetail[key];
          return (
            <span className={`bias-tf ${biasClass(read.bias)}`} key={label} title={read.reasons[0]}>
              <small>{label}</small>
              <BiasIcon bias={read.bias} />
            </span>
          );
        })}
        {invalidation !== undefined && (
          <span className="bias-invalidation">
            <small>Bu yön biter</small>
            <strong>{formatPrice(invalidation)}</strong>
          </span>
        )}
      </div>

      <div className="bias-symbol-grid">
        {reads.map(({ context, day }) => (
          <button
            className={`bias-symbol ${biasClass(day.bias)} ${context.symbol === activeSymbol ? "active" : ""}`}
            key={context.symbol}
            onClick={() => onSelectSymbol(context.symbol)}
            title={`${day.note}. ${context.biasDetail.daily.reasons[0]}`}
            type="button"
          >
            <BiasIcon bias={day.bias} />
            <span>{context.symbol}</span>
          </button>
        ))}
      </div>
    </article>
  );
}
