import type { MarketSymbol } from "../lib/ict/types";
import type { UserRules } from "../lib/userRules/userRules";

const SYMBOLS: MarketSymbol[] = ["XAUUSD", "NAS100", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCHF", "BTCUSD", "ETHUSD", "XRPUSD", "BNBUSD", "SOLUSD"];

// Sade ayarlar: yalnız hesap/risk ve semboller. Strateji kuralları (RR kapısı, filtreler, çıkış
// modeli) sabit; onlar Replay'deki ölçümle değişir, ayar kutucuğuyla değil.
export function SettingsView({
  rules,
  onRulesChange
}: {
  rules: UserRules;
  onRulesChange: (rules: UserRules) => void;
}) {
  const updateNumber = (key: "accountSize" | "riskPerTradePct" | "maxDailyRiskPct", value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    onRulesChange({ ...rules, [key]: value });
  };
  const toggleSymbol = (symbol: MarketSymbol) => {
    const next = rules.allowedSymbols.includes(symbol)
      ? rules.allowedSymbols.filter((item) => item !== symbol)
      : [...rules.allowedSymbols, symbol];
    onRulesChange({ ...rules, allowedSymbols: next.length ? next : rules.allowedSymbols });
  };
  const riskAmount = (rules.accountSize * rules.riskPerTradePct) / 100;
  const dailyAmount = (rules.accountSize * rules.maxDailyRiskPct) / 100;
  return (
    <section className="settings-grid">
      <article className="panel">
        <header className="panel-head"><h2>Hesap ve risk</h2></header>
        <div className="form-grid">
          <label>Hesap büyüklüğü
            <input type="number" min="1" value={rules.accountSize} onChange={(event) => updateNumber("accountSize", Number(event.target.value))} />
          </label>
          <label>İşlem başı risk %
            <input type="number" step="0.1" min="0.1" value={rules.riskPerTradePct} onChange={(event) => updateNumber("riskPerTradePct", Number(event.target.value))} />
          </label>
          <label>Günlük max kayıp %
            <input type="number" step="0.5" min="0.5" value={rules.maxDailyRiskPct} onChange={(event) => updateNumber("maxDailyRiskPct", Number(event.target.value))} />
          </label>
        </div>
        <p className="settings-note">
          İşlem başı en fazla {riskAmount.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} · günlük en fazla {dailyAmount.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} kayıp.
          Lot büyüklüğü sinyalin grade'ine göre bu riskten otomatik hesaplanır.
        </p>
      </article>
      <article className="panel">
        <header className="panel-head"><h2>Semboller</h2><span className="badge">{rules.allowedSymbols.length}/{SYMBOLS.length}</span></header>
        <div className="toggle-grid compact">
          {SYMBOLS.map((symbol) => (
            <label key={symbol}><input type="checkbox" checked={rules.allowedSymbols.includes(symbol)} onChange={() => toggleSymbol(symbol)} /> {symbol}</label>
          ))}
        </div>
      </article>
    </section>
  );
}
