import type { MarketSymbol } from "../lib/ict/types";
import type { RuntimeMarketMemory } from "../lib/memory/marketMemory";
import type { StrategyModule } from "../lib/strategies/types";
import { MIN_VISIBLE_SIGNAL_SCORE } from "../lib/userRules/scorePolicy";
import type { UserRules } from "../lib/userRules/userRules";

const SYMBOLS: MarketSymbol[] = ["XAUUSD", "NAS100", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCHF", "BTCUSD", "ETHUSD", "XRPUSD", "BNBUSD", "SOLUSD"];
const KILLZONES = ["Asia", "London", "New York AM", "London Close", "Outside"];

export function SettingsView({
  strategies,
  rules,
  memory,
  onRulesChange
}: {
  strategies: StrategyModule[];
  rules: UserRules;
  memory: RuntimeMarketMemory;
  onRulesChange: (rules: UserRules) => void;
}) {
  const updateNumber = (key: "minimumRR" | "minimumScore" | "maxSignalsPerScan" | "moveToBreakevenAtR" | "maxDailyRiskPct", value: number) => {
    const next = Number.isFinite(value) ? value : 0;
    const normalized = key === "minimumScore" ? Math.min(100, Math.max(MIN_VISIBLE_SIGNAL_SCORE, next)) : next;
    onRulesChange({ ...rules, [key]: normalized });
  };
  const toggleSymbol = (symbol: MarketSymbol) => {
    const next = rules.allowedSymbols.includes(symbol)
      ? rules.allowedSymbols.filter((item) => item !== symbol)
      : [...rules.allowedSymbols, symbol];
    onRulesChange({ ...rules, allowedSymbols: next.length ? next : rules.allowedSymbols });
  };
  const toggleKillzone = (killzone: string) => {
    const next = rules.allowedKillzones.includes(killzone)
      ? rules.allowedKillzones.filter((item) => item !== killzone)
      : [...rules.allowedKillzones, killzone];
    onRulesChange({ ...rules, allowedKillzones: next.length ? next : rules.allowedKillzones });
  };
  return (
    <section className="settings-grid">
      <article className="panel">
        <header className="panel-head"><h2>Strateji</h2><span className="badge">{strategies.length}</span></header>
        <div className="list-stack">
          {strategies.map((strategy) => (
            <div className="row-item" key={strategy.id}>
              <strong>{strategy.name}</strong>
              <span>{strategy.description}</span>
              <b>{strategy.requiredTimeframes.join(", ")}</b>
            </div>
          ))}
        </div>
      </article>
      <article className="panel">
        <header className="panel-head"><h2>Kurallar</h2><span className="badge">lokal</span></header>
        <div className="form-grid">
          <label>Stop profili
            <select value={rules.stopProfile} onChange={(event) => onRulesChange({ ...rules, stopProfile: event.target.value as UserRules["stopProfile"] })}>
              <option value="aggressive">aggressive</option>
              <option value="normal">normal</option>
              <option value="conservative">conservative</option>
            </select>
          </label>
          <label>Slippage stress
            <select value={rules.slippageStress} onChange={(event) => onRulesChange({ ...rules, slippageStress: event.target.value as UserRules["slippageStress"] })}>
              <option value="normal">normal</option>
              <option value="high">high volatility</option>
            </select>
          </label>
          <label>Minimum RR<input type="number" step="0.1" value={rules.minimumRR} onChange={(event) => updateNumber("minimumRR", Number(event.target.value))} /></label>
          <label>Minimum score (C altı gizli)<input type="number" min={MIN_VISIBLE_SIGNAL_SCORE} max="100" value={rules.minimumScore} onChange={(event) => updateNumber("minimumScore", Number(event.target.value))} /></label>
          <label>Max sinyal<input type="number" min="1" value={rules.maxSignalsPerScan} onChange={(event) => updateNumber("maxSignalsPerScan", Number(event.target.value))} /></label>
          <label>BE tetikleyici R<input type="number" step="0.25" min="0" value={rules.moveToBreakevenAtR} onChange={(event) => updateNumber("moveToBreakevenAtR", Number(event.target.value))} /></label>
          <label>Max günlük risk %<input type="number" step="0.25" min="0" value={rules.maxDailyRiskPct} onChange={(event) => updateNumber("maxDailyRiskPct", Number(event.target.value))} /></label>
        </div>
        <div className="toggle-grid">
          <label><input type="checkbox" checked={rules.partialTpEnabled} onChange={(event) => onRulesChange({ ...rules, partialTpEnabled: event.target.checked })} /> Partial TP</label>
          <label><input type="checkbox" checked={rules.useExecutionCosts} onChange={(event) => onRulesChange({ ...rules, useExecutionCosts: event.target.checked })} /> Spread / slippage dahil</label>
          <label><input type="checkbox" checked={rules.avoidNews} onChange={(event) => onRulesChange({ ...rules, avoidNews: event.target.checked })} /> Haber saatinde no trade</label>
          <label><input type="checkbox" checked={rules.usePremiumDiscountFilter} onChange={(event) => onRulesChange({ ...rules, usePremiumDiscountFilter: event.target.checked })} /> Premium / Discount</label>
          <label><input type="checkbox" checked={rules.useJudasSwingFilter} onChange={(event) => onRulesChange({ ...rules, useJudasSwingFilter: event.target.checked })} /> Judas Swing</label>
          <label><input type="checkbox" checked={rules.useHtfAlignmentFilter} onChange={(event) => onRulesChange({ ...rules, useHtfAlignmentFilter: event.target.checked })} /> HTF alignment</label>
        </div>
        <div className="selector-block">
          <strong>Taranacak symbol</strong>
          <div className="toggle-grid compact">
            {SYMBOLS.map((symbol) => <label key={symbol}><input type="checkbox" checked={rules.allowedSymbols.includes(symbol)} onChange={() => toggleSymbol(symbol)} /> {symbol}</label>)}
          </div>
        </div>
        <div className="selector-block">
          <strong>Killzone</strong>
          <div className="toggle-grid compact">
            {KILLZONES.map((killzone) => <label key={killzone}><input type="checkbox" checked={rules.allowedKillzones.includes(killzone)} onChange={() => toggleKillzone(killzone)} /> {killzone}</label>)}
          </div>
        </div>
      </article>
      <article className="panel wide">
        <header className="panel-head"><h2>Oturum hafızası</h2><span className="badge">yenilemede sıfırlanır</span></header>
        <p>Aktif symbol {memory.activeSymbol} · son bias {memory.latestBias} · önceki bias {memory.previousBias ?? "yok"} · son sinyal {memory.recentSignals.length} · elenen {memory.rejectedSetups.length} · scan {memory.scanHistory.length}</p>
      </article>
    </section>
  );
}
